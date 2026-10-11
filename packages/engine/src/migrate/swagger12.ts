// The legacy Sales sample kept a Swagger 1.2 spec. The API spec feature reads only OpenAPI 3, so the migration converts
// that spec once: what it describes (paths, methods, parameters, models, the server) maps onto an OpenAPI 3.0 document.

type Raw = Record<string, unknown>

const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const entries = (v: unknown): [string, unknown][] => (isObject(v) ? Object.entries(v).filter(([k]) => k !== '__proto__') : [])
const own = (v: unknown, key: string): unknown => (isObject(v) && Object.hasOwn(v, key) ? v[key] : undefined)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Swagger 1.2 primitive types as JSON Schema types. */
const TYPES: Record<string, string> = { integer: 'integer', int: 'integer', long: 'integer', float: 'number', double: 'number', number: 'number', boolean: 'boolean' }
const schemaType = (type: string) => (Object.hasOwn(TYPES, type) ? TYPES[type]! : 'string')
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })

function property(raw: unknown): Raw {
  const out: Raw = {}
  const type = str(own(raw, 'type'))
  const items = str(own(own(raw, 'items'), '$ref'))
  if (type === 'array') {
    out.type = 'array'
    out.items = items ? ref(items) : { type: schemaType(str(own(own(raw, 'items'), 'type'))) }
  } else if (str(own(raw, '$ref'))) {
    Object.assign(out, ref(str(own(raw, '$ref'))))
  } else {
    out.type = schemaType(type)
  }
  const description = str(own(raw, 'description'))
  if (description) out.description = description
  return out
}

/** Whether a value is a Swagger 1.2 API declaration (what the legacy app fetched and kept). */
export function isSwagger12(spec: unknown): spec is Raw {
  return isObject(spec) && typeof spec.swaggerVersion === 'string' && Array.isArray(spec.apis)
}

/** A Swagger 1.2 API declaration as an OpenAPI 3.0 document describing the same operations. */
export function swagger12ToOpenApi(spec: Raw): Raw {
  const schemas = Object.fromEntries(
    entries(spec.models).map(([name, model]) => {
      const out: Raw = { type: 'object', properties: Object.fromEntries(entries(own(model, 'properties')).map(([p, raw]) => [p, property(raw)])) }
      const required = list(own(model, 'required')).filter((r): r is string => typeof r === 'string')
      if (required.length > 0) out.required = required
      return [name, out]
    }),
  )
  const paths: Raw = {}
  for (const api of list(spec.apis)) {
    const path = str(own(api, 'path'))
    if (!path) continue
    const item: Raw = {}
    for (const op of list(own(api, 'operations'))) {
      const method = str(own(op, 'method')).toLowerCase()
      if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) continue
      const out: Raw = { responses: {} }
      const summary = str(own(op, 'summary'))
      if (summary) out.summary = summary
      const params = list(own(op, 'parameters'))
      const located = params.filter((p) => ['path', 'query', 'header'].includes(str(own(p, 'paramType'))))
      if (located.length > 0) {
        out.parameters = located.map((p) => ({
          name: str(own(p, 'name')),
          in: str(own(p, 'paramType')),
          required: own(p, 'required') === true || str(own(p, 'paramType')) === 'path',
          ...(str(own(p, 'description')) ? { description: str(own(p, 'description')) } : {}),
          schema: { type: schemaType(str(own(p, 'type'))) },
        }))
      }
      // Form and body parameters become a form-encoded request body, as the legacy form posted them.
      const fields = params.filter((p) => ['form', 'body'].includes(str(own(p, 'paramType'))))
      if (fields.length > 0) {
        const properties = Object.fromEntries(fields.map((p) => [str(own(p, 'name')), { type: schemaType(str(own(p, 'type'))), ...(str(own(p, 'description')) ? { description: str(own(p, 'description')) } : {}) }]))
        out.requestBody = { content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', properties } } } }
      }
      const type = str(own(op, 'type'))
      const status = method === 'post' ? '201' : '200'
      out.responses = { [status]: { description: 'OK', ...(type && Object.hasOwn(schemas, type) ? { content: { 'application/json': { schema: ref(type) } } } : {}) } }
      item[method] = out
    }
    if (Object.keys(item).length > 0) paths[path] = item
  }
  const base = str(spec.basePath)
  return {
    openapi: '3.0.3',
    info: { title: str(spec.resourcePath).replace(/^\//, '') || 'API', version: str(spec.apiVersion) || '1' },
    ...(base ? { servers: [{ url: base }] } : {}),
    paths,
    components: { schemas },
  }
}
