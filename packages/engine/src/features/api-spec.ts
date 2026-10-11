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

/** A JSON-Schema-like object as our DataSchema: properties with their type, description and item reference. */
function schemaOf(raw: unknown): DataSchema {
  const out: DataSchema = {}
  const type = typeOf(raw)
  if (type) out.type = type
  const items = refName(own(own(raw, 'items'), '$ref'))
  if (items) out.items = { $ref: items }
  const properties = entries(own(raw, 'properties'))
  if (properties.length > 0) {
    out.properties = Object.fromEntries(
      properties.map(([name, p]) => {
        const property: NonNullable<DataSchema['properties']>[string] = {}
        const pType = typeOf(p) || (own(p, '$ref') ? 'object' : '')
        if (pType) property.type = pType
        const description = str(own(p, 'description'))
        if (description) property.description = description
        const itemRef = refName(own(own(p, 'items'), '$ref'))
        if (itemRef) property.items = { $ref: itemRef }
        return [name, property]
      }),
    )
  }
  return out
}

/** A response schema as a schema name: a reference by its name, an inline schema registered under `name`. */
function responseType(raw: unknown, name: string, schemas: Record<string, DataSchema>): string | undefined {
  if (!isObject(raw)) return undefined
  const ref = refName(own(raw, '$ref'))
  if (ref) return ref
  schemas[name] = schemaOf(raw)
  return name
}

const method = (m: string) => m.toUpperCase()
const isMethod = (m: string): m is (typeof HTTP_METHODS)[number] => (HTTP_METHODS as readonly string[]).includes(method(m))

function parameter(raw: unknown, fallbackIn: DataParameter['in']): DataParameter | undefined {
  const name = str(own(raw, 'name'))
  if (!name) return undefined
  const where = str(own(raw, 'in')) || fallbackIn
  return {
    name,
    in: (['path', 'query', 'header'] as const).find((w) => w === where) ?? fallbackIn,
    type: typeOf(raw) || typeOf(own(raw, 'schema')) || 'string',
    description: str(own(raw, 'description')),
    required: own(raw, 'required') === true,
  }
}

/** A request body schema's properties as form fields (what a Form shows). */
function bodyFields(schema: unknown, schemas: Record<string, DataSchema>): DataParameter[] {
  const ref = refName(own(schema, '$ref'))
  const resolved = ref ? (Object.hasOwn(schemas, ref) ? schemas[ref] : undefined) : schemaOf(schema)
  return Object.entries(resolved?.properties ?? {}).map(([name, p]) => ({ name, in: 'form' as const, type: p.type ?? 'string', description: p.description ?? '', required: false }))
}

function read3(spec: Raw, specUrl: string): ReadSpec {
  const schemas: Record<string, DataSchema> = Object.fromEntries(entries(own(spec.components, 'schemas')).map(([name, s]) => [name, schemaOf(s)]))
  const server = str(own(Array.isArray(spec.servers) ? spec.servers[0] : undefined, 'url'))
  // A relative server URL is relative to where the spec came from (resolved by hand: the engine uses no platform URL API).
  let base = server
  const from = /^(https?:\/\/[^/?#]+)([^?#]*)/i.exec(specUrl)
  if (server && !/^[a-z][a-z\d+.-]*:/i.test(server) && from) {
    base = server.startsWith('/') ? `${from[1]}${server}` : `${from[1]}${from[2]!.replace(/[^/]*$/, '')}${server.replace(/^\.\//, '')}`
  }
  base = base.replace(/\/$/, '')
  const json = (content: unknown) => own(own(content, 'application/json'), 'schema') ?? own(own(content, 'application/x-www-form-urlencoded'), 'schema')
  const operations: DataOperation[] = []
  for (const [path, item] of entries(spec.paths)) {
    const shared = Array.isArray(own(item, 'parameters')) ? (own(item, 'parameters') as unknown[]) : []
    for (const [m, op] of entries(item)) {
      if (!isMethod(m)) continue
      const params = [...shared, ...(Array.isArray(own(op, 'parameters')) ? (own(op, 'parameters') as unknown[]) : [])].flatMap((p) => parameter(p, 'query') ?? [])
      const body = json(own(own(op, 'requestBody'), 'content'))
      const fields = body ? [...params, ...bodyFields(body, schemas)] : params
      const responses = own(op, 'responses')
      const ok = own(responses, '200') ?? own(responses, '201')
      const name = `${method(m)} ${path}`
      operations.push(operation(method(m), path, base, str(own(op, 'summary')), fields, responseType(json(own(ok, 'content')), `${name} response`, schemas)))
    }
  }
  return { format: `OpenAPI ${str(spec.openapi)}`, title: str(own(spec.info, 'title')), operations, schemas }
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
    if (text === '') {
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
