// Reads an OpenAPI 3 description (3.0 or 3.1) into the operations and schemas data resources export. Pure: the spec is
// stored in the model (the editor loads it), so generation never fetches anything. Older Swagger specs aren't read;
// the legacy sample's Swagger 1.2 spec is converted to OpenAPI 3 by the migration (migrate/swagger12.ts).

import type { FeatureDefinition } from '../feature.js'
import { asOneOf, asString, nameInput } from '../inputs.js'
import { HTTP_METHODS, MAX_SAMPLE_ROWS, parseSampleRows, type DataOperation, type DataParameter, type DataResourceExports, type DataSchema } from './data-resource.js'


export interface ReadSpec {
  /** e.g. "OpenAPI 3.1.0" */
  format: string
  title: string
  operations: DataOperation[]
  schemas: Record<string, DataSchema>
}

/** At most this many operations are read, so a huge spec can't swamp the editor. */
export const MAX_SPEC_OPERATIONS = 200

type Raw = Record<string, unknown>

const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v : '')
/** Own entries only: a spec is outside data, so "__proto__" or "constructor" keys are never followed. */
const entries = (v: unknown): [string, unknown][] => (isObject(v) ? Object.entries(v).filter(([k]) => k !== '__proto__') : [])
const own = (v: unknown, key: string): unknown => (isObject(v) && Object.hasOwn(v, key) ? v[key] : undefined)

/** "#/definitions/Pet" or "#/components/schemas/Pet" (or a bare "Pet", as Swagger 1.2 writes it) -> "Pet". */
function refName(ref: unknown): string | undefined {
  const r = str(ref)
  return r ? r.slice(r.lastIndexOf('/') + 1) : undefined
}

/** A schema's type; OpenAPI 3.1 may list several (e.g. ["string", "null"]): the first that isn't null. */
function typeOf(raw: unknown): string {
  const type = own(raw, 'type')
  return Array.isArray(type) ? str(type.find((t) => t !== 'null')) : str(type)
}

/** At most this many characters of spec are stored and read; bigger specs would fill the browser's storage. */
export const MAX_SPEC_CHARS = 1_000_000

/** What reading one spec needs: the spec (for its shared components), and the schemas found so far. */
interface Reader {
  spec: Raw
  schemas: Record<string, DataSchema>
}

/**
 * A value, or what its local "$ref" ("#/components/<kind>/<name>") points to, followed a few levels at most (a loop of
 * references ends there). Specs share parameters, request bodies and responses this way.
 */
function deref(reader: Reader, value: unknown, kind: string, depth = 0): unknown {
  const ref = str(own(value, '$ref'))
  if (!ref || depth > 5) return value
  const match = /^#\/components\/([^/]+)\/([^/]+)$/.exec(ref)
  if (!match || match[1] !== kind) return value
  return deref(reader, own(own(own(reader.spec, 'components'), kind), match[2]!), kind, depth + 1)
}

/** A JSON-Schema-like object as our DataSchema. An inline list item with properties is registered as `<name> item`. */
function schemaOf(reader: Reader, raw: unknown, name: string): DataSchema {
  const out: DataSchema = {}
  const type = typeOf(raw)
  if (type) out.type = type
  const items = itemRef(reader, own(raw, 'items'), `${name} item`)
  if (items) out.items = { $ref: items }
  const required = own(raw, 'required')
  if (Array.isArray(required) && required.length > 0) out.required = required.filter((r): r is string => typeof r === 'string')
  const properties = entries(own(raw, 'properties'))
  if (properties.length > 0) {
    out.properties = Object.fromEntries(
      properties.map(([prop, p]) => {
        const property: NonNullable<DataSchema['properties']>[string] = {}
        const pType = typeOf(p) || (own(p, '$ref') ? 'object' : '')
        if (pType) property.type = pType
        const description = str(own(p, 'description'))
        if (description) property.description = description
        const ref = itemRef(reader, own(p, 'items'), `${name}.${prop} item`)
        if (ref) property.items = { $ref: ref }
        return [prop, property]
      }),
    )
  }
  return out
}

/** A list's item schema as a schema name: a reference by its name, an inline object with properties registered. */
function itemRef(reader: Reader, items: unknown, name: string): string | undefined {
  const ref = refName(own(items, '$ref'))
  if (ref) return ref
  if (!isObject(own(items, 'properties'))) return undefined
  reader.schemas[name] = schemaOf(reader, items, name)
  return name
}

/** A response schema as a schema name: a reference by its name, an inline schema registered under `name`. */
function responseType(reader: Reader, raw: unknown, name: string): string | undefined {
  if (!isObject(raw)) return undefined
  const ref = refName(own(raw, '$ref'))
  if (ref) return ref
  reader.schemas[name] = schemaOf(reader, raw, name)
  return name
}

const method = (m: string) => m.toUpperCase()
const isMethod = (m: string): m is (typeof HTTP_METHODS)[number] => (HTTP_METHODS as readonly string[]).includes(method(m))

/** A parameter (followed if shared), or nothing for cookies and nameless ones. */
function parameter(reader: Reader, raw: unknown): DataParameter | undefined {
  const p = deref(reader, raw, 'parameters')
  const name = str(own(p, 'name'))
  const where = str(own(p, 'in')) || 'query'
  if (!name || where === 'cookie') return undefined
  return {
    name,
    in: (['path', 'query', 'header'] as const).find((w) => w === where) ?? 'query',
    type: typeOf(p) || typeOf(own(p, 'schema')) || 'string',
    description: str(own(p, 'description')),
    required: own(p, 'required') === true,
  }
}

/** A request body schema's properties as form fields (what a Form shows). */
function bodyFields(reader: Reader, schema: unknown, name: string): DataParameter[] {
  const ref = refName(own(schema, '$ref'))
  const resolved = ref ? (Object.hasOwn(reader.schemas, ref) ? reader.schemas[ref] : undefined) : schemaOf(reader, schema, name)
  return Object.entries(resolved?.properties ?? {}).map(([field, p]) => ({ name: field, in: 'form' as const, type: p.type ?? 'string', description: p.description ?? '', required: resolved?.required?.includes(field) ?? false }))
}

/** The schema of a request body or response: JSON (any JSON media type) first, then a form, then whatever is there. */
function mediaSchema(content: unknown): unknown {
  return media(content)?.schema
}

/** The chosen media type's schema, and whether it is a form (form-encoded or multipart) rather than JSON. */
function media(content: unknown): { schema: unknown; form?: 'form' | 'multipart' } | undefined {
  const types = entries(content)
  const json = types.find(([t]) => /^application\/([\w.-]+\+)?json\b/i.test(t))
  const form = types.find(([t]) => /^(application\/x-www-form-urlencoded|multipart\/form-data)\b/i.test(t))
  const pick = json ?? form ?? types[0]
  if (!pick) return undefined
  const out: { schema: unknown; form?: 'form' | 'multipart' } = { schema: own(pick[1], 'schema') }
  if (!json && pick === form) out.form = /^multipart\//i.test(pick[0]) ? 'multipart' : 'form'
  return out
}

/** The success response: 200, 201, 2XX, default, then any other 2xx. */
function successResponse(reader: Reader, responses: unknown): unknown {
  const keys = entries(responses).map(([k]) => k)
  const key = ['200', '201', '2XX', '2xx', 'default'].find((k) => keys.includes(k)) ?? keys.find((k) => /^2\d\d$/.test(k))
  return key === undefined ? undefined : deref(reader, own(responses, key), 'responses')
}

/**
 * The base URL operations hang off: the first server, with its variables filled in from their defaults. No server
 * means the spec's own site ("/"); a relative or protocol-relative one is resolved against where the spec came from
 * (by hand: the engine uses no platform URL API).
 */
function baseUrl(spec: Raw, specUrl: string): string {
  const first = Array.isArray(spec.servers) ? spec.servers[0] : undefined
  const variables = own(first, 'variables')
  let server = (str(own(first, 'url')) || '/').replace(/\{([^}]+)\}/g, (whole, name: string) => {
    const variable = own(variables, name)
    const value = str(own(variable, 'default')) || str(Array.isArray(own(variable, 'enum')) ? (own(variable, 'enum') as unknown[])[0] : '')
    return value || whole
  })
  const from = /^(https?:)\/\/([^/?#]+)([^?#]*)/i.exec(specUrl)
  if (server.startsWith('//')) server = `${from?.[1] ?? 'https:'}${server}`
  else if (!/^[a-z][a-z\d+.-]*:/i.test(server) && from) {
    const origin = `${from[1]}//${from[2]}`
    server = server.startsWith('/') ? `${origin}${server}` : `${origin}${from[3]!.replace(/[^/]*$/, '')}${server.replace(/^\.\//, '')}`
  }
  return server.replace(/\/+$/, '')
}

function read3(spec: Raw, specUrl: string): ReadSpec {
  const reader: Reader = { spec, schemas: {} }
  for (const [name, schema] of entries(own(spec.components, 'schemas'))) reader.schemas[name] = schemaOf(reader, schema, name)
  const base = baseUrl(spec, specUrl)
  const operations: DataOperation[] = []
  for (const [path, item] of entries(spec.paths)) {
    const shared = Array.isArray(own(item, 'parameters')) ? (own(item, 'parameters') as unknown[]) : []
    for (const [m, op] of entries(item)) {
      if (!isMethod(m)) continue
      const name = `${method(m)} ${path}`
      // Parameters declared on the operation replace those of the path with the same name and location.
      const byKey = new Map<string, DataParameter>()
      const own_ = Array.isArray(own(op, 'parameters')) ? (own(op, 'parameters') as unknown[]) : []
      for (const p of [...shared, ...own_].flatMap((raw) => parameter(reader, raw) ?? [])) byKey.set(`${p.in} ${p.name}`, p)
      const requestBody = media(own(deref(reader, own(op, 'requestBody'), 'requestBodies'), 'content'))
      const body = requestBody?.schema
      const fields = body ? [...byKey.values(), ...bodyFields(reader, body, `${name} body`)] : [...byKey.values()]
      const ok = successResponse(reader, own(op, 'responses'))
      const read = operation(method(m), path, base, str(own(op, 'summary')), fields, responseType(reader, mediaSchema(own(ok, 'content')), `${name} response`))
      if (requestBody?.form) read.requestType = requestBody.form
      operations.push(read)
    }
  }
  return { format: `OpenAPI ${str(spec.openapi)}`, title: str(own(spec.info, 'title')), operations, schemas: reader.schemas }
}

function operation(m: string, path: string, base: string, summary: string, parameters: DataParameter[], response: string | undefined): DataOperation {
  const op: DataOperation = { name: `${m} ${path}`, method: m, endPoint: `${base}${path}` }
  if (summary) op.summary = summary
  if (parameters.length > 0) op.parameters = parameters
  if (response) op.responseType = response
  return op
}

/**
 * Reads an OpenAPI 3 spec (already parsed JSON). `specUrl` resolves a relative server URL. Returns what it read, or a
 * problem in words when it isn't one.
 */
export function readApiSpec(spec: unknown, specUrl = ''): ReadSpec | { problem: string } {
  if (!isObject(spec)) return { problem: 'The spec is not a JSON object' }
  if (!(typeof spec.openapi === 'string' && /^3\./.test(spec.openapi))) {
    return { problem: spec.swagger || spec.swaggerVersion ? 'Only OpenAPI 3 specs are read; convert this Swagger spec to OpenAPI 3 first' : 'Not an OpenAPI 3 spec' }
  }
  const read = read3(spec, specUrl)
  return { ...read, operations: read.operations.slice(0, MAX_SPEC_OPERATIONS) }
}

/**
 * A data resource described by an API spec (legacy SwaggerDataResource). The spec is stored in the model as JSON text
 * (the editor's "Load spec" fetches it from Spec URL), so generation is pure; its operations and schemas are what
 * Tables, Charts and Forms use. With Sample data its operations are answered in the browser from sample rows.
 */
export const ApiSpecFeature: FeatureDefinition = {
  type: 'SwaggerDataResourceFeature',
  name: 'API spec',
  icon: 'file-code',
  placement: 'none',
  inputs: [
    nameInput(),
    { name: 'spec_url', label: 'Spec URL', type: 'string', default: '', placeholder: 'https://…/openapi.json', control: 'text-input' },
    { name: 'spec', label: 'Spec', type: 'text', default: '', control: 'api-spec' },
    {
      name: 'source',
      label: 'Answer with',
      type: 'string',
      default: 'address',
      control: 'segmented',
      options: [
        { value: 'address', text: 'The API' },
        { value: 'sample', text: 'Sample data' },
      ],
    },
    { name: 'sample_rows', label: 'Sample rows (JSON)', type: 'text', default: '[]', control: 'json-area', showWhen: { input: 'source', equals: 'sample' } },
  ],

  generate(inputs, ctx) {
    const exports: DataResourceExports = { resource: asString(inputs.name), operations: [], schemas: {} }
    const text = asString(inputs.spec).trim()
    if (text.length > MAX_SPEC_CHARS) {
      ctx.report('error', `The spec is too large (${(text.length / 1_000_000).toFixed(1)} MB; at most ${MAX_SPEC_CHARS / 1_000_000} MB can be stored in the browser)`)
    } else if (text === '') {
      ctx.report('warning', 'No spec loaded yet: enter the Spec URL and choose Load spec, or paste the spec')
    } else {
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch (error) {
        ctx.report('error', `The spec is not valid JSON (${error instanceof Error ? error.message : String(error)})`)
      }
      const read = parsed === undefined ? undefined : readApiSpec(parsed, asString(inputs.spec_url))
      if (read && 'problem' in read) ctx.report('error', read.problem)
      else if (read) {
        exports.operations = read.operations
        exports.schemas = read.schemas
        if (read.operations.length === 0) ctx.report('warning', `The ${read.format} spec has no operations`)
      }
    }
    if (asOneOf(inputs.source, ['address', 'sample'], 'address') === 'sample') {
      const parsed = parseSampleRows(asString(inputs.sample_rows))
      if (parsed.problem) ctx.report('warning', parsed.problem)
      if (parsed.rows.length > MAX_SAMPLE_ROWS) ctx.report('warning', `Only the first ${MAX_SAMPLE_ROWS} of ${parsed.rows.length} sample rows are used`)
      exports.sampleRows = parsed.rows.slice(0, MAX_SAMPLE_ROWS)
      exports.operations = exports.operations.map((o) => ({ ...o, sample: true as const }))
    }
    return { exports: { ...exports } }
  },
}
