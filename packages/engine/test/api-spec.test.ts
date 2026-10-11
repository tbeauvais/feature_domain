import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  ApiSpecFeature,
  generate,
  initialInputs,
  MAX_SPEC_OPERATIONS,
  migrate,
  readApiSpec,
  type DataResourceExports,
  type FeatureContext,
  type ReadSpec,
} from '../src'
import { swagger12ToOpenApi } from '../src/migrate/swagger12'
import { inst, model, page } from './helpers'

const salesSample = JSON.parse(readFileSync(new URL('../../../app_models/swagger_resource_sample.json', import.meta.url), 'utf8'))
const salesSwagger12 = salesSample.features.find((f: { feature: string }) => f.feature === 'SwaggerDataResourceFeature').cache.swagger
const salesSpec = swagger12ToOpenApi(salesSwagger12)

const read = (spec: unknown, url?: string) => {
  const r = readApiSpec(spec, url)
  if ('problem' in r) throw new Error(r.problem)
  return r as ReadSpec
}

const petstore3 = {
  openapi: '3.0.3',
  info: { title: 'Petstore 3' },
  servers: [{ url: '/api/v3' }],
  components: { schemas: { Pet: { type: 'object', properties: { name: { type: 'string' }, tag: { type: 'string' } } } } },
  paths: {
    '/pets': {
      get: { responses: { '200': { content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } } } } } } },
      post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } }, responses: { '201': {} } },
    },
  },
}

describe('readApiSpec', () => {
  it('reads the legacy Sales spec once the migration has converted it from Swagger 1.2 to OpenAPI 3', () => {
    const r = read(salesSpec)
    expect(r.format).toBe('OpenAPI 3.0.3')
    expect(r.operations.map((o) => o.name)).toEqual(['GET /v1/sales', 'POST /v1/sales', 'GET /v1/sales/{id}', 'PUT /v1/sales/{id}', 'DELETE /v1/sales/{id}'])
    expect(r.operations[0]).toMatchObject({ method: 'GET', endPoint: 'http://sales-api.mybluemix.net/v1/sales', responseType: 'Sales', summary: 'List of sales' })
    expect(r.operations[1]!.parameters).toEqual([
      { name: 'name', in: 'form', type: 'string', description: 'Name of sales person.', required: false },
      { name: 'amount', in: 'form', type: 'number', description: 'Total sales for sales person.', required: false },
    ])
    expect(r.operations[2]!.parameters).toEqual([{ name: 'id', in: 'path', type: 'string', description: 'Sales record id', required: true }])
    expect(r.schemas.Sales).toEqual({ type: 'object', properties: { count: { type: 'integer', description: 'Total number of sales.' }, sales: { type: 'array', description: 'All sales.', items: { $ref: 'Sale' } } } })
  })

  it('reads OpenAPI 3.1 types that allow null', () => {
    const spec = { openapi: '3.1.0', paths: {}, components: { schemas: { Pet: { type: 'object', properties: { tag: { type: ['string', 'null'] } } } } } }
    expect(read(spec).schemas.Pet).toEqual({ type: 'object', properties: { tag: { type: 'string' } } })
  })

  it('reads OpenAPI 3, resolving a relative server against the spec address', () => {
    const r = read(petstore3, 'https://pets.test/docs/openapi.json')
    expect(r.format).toBe('OpenAPI 3.0.3')
    expect(r.operations.map((o) => o.endPoint)).toEqual(['https://pets.test/api/v3/pets', 'https://pets.test/api/v3/pets'])
    expect(read({ ...petstore3, servers: [{ url: 'v2/' }] }, 'https://pets.test/docs/openapi.json').operations[0]!.endPoint).toBe('https://pets.test/docs/v2/pets')
    expect(r.operations[1]!.parameters?.map((p) => p.name)).toEqual(['name', 'tag'])
  })

  it('says what is wrong with something that is not a spec, and never follows prototype keys', () => {
    expect(readApiSpec([1, 2])).toEqual({ problem: 'The spec is not a JSON object' })
    expect(readApiSpec({ hello: 'world' })).toEqual({ problem: 'Not an OpenAPI 3 spec' })
    // Older Swagger specs aren't read: they say how to get one that is.
    for (const old of [{ swagger: '2.0', paths: {} }, salesSwagger12]) expect(readApiSpec(old)).toEqual({ problem: 'Only OpenAPI 3 specs are read; convert this Swagger spec to OpenAPI 3 first' })
    const hostile = JSON.parse('{"openapi": "3.0.0", "paths": {"__proto__": {"get": {}}, "/ok": {"constructor": {}, "get": {}}}}')
    expect(read(hostile).operations.map((o) => o.name)).toEqual(['GET /ok'])
    const many = { openapi: '3.0.0', paths: Object.fromEntries(Array.from({ length: MAX_SPEC_OPERATIONS + 10 }, (_, i) => [`/p${i}`, { get: {} }])) }
    expect(read(many).operations).toHaveLength(MAX_SPEC_OPERATIONS)
  })
})

describe('ApiSpecFeature', () => {
  const run = (inputs: Record<string, unknown>) => {
    const report = vi.fn<FeatureContext['report']>()
    const ctx: FeatureContext = { instanceId: 's', nodeId: () => 's', resolve: () => undefined, report }
    const out = ApiSpecFeature.generate({ ...initialInputs(ApiSpecFeature.inputs), ...inputs } as never, ctx)
    return { exports: out.exports as unknown as DataResourceExports, problems: report.mock.calls.map((c) => `${c[0]}: ${c[1]}`) }
  }

  it('exports the stored spec\'s operations and schemas', () => {
    const { exports, problems } = run({ name: 'Sales', spec: JSON.stringify(salesSpec) })
    expect(problems).toEqual([])
    expect(exports.resource).toBe('Sales')
    expect(exports.operations).toHaveLength(5)
    expect(exports.schemas.Sale?.properties).toHaveProperty('amount')
  })

  it('reports a missing, broken or unknown spec, exporting no operations', () => {
    expect(run({}).problems).toEqual(['warning: No spec loaded yet: enter the Spec URL and choose Load spec, or paste the spec'])
    expect(run({ spec: '{oops' }).problems[0]).toMatch(/^error: The spec is not valid JSON/)
    expect(run({ spec: '{"x": 1}' })).toMatchObject({ exports: { operations: [] }, problems: ['error: Not an OpenAPI 3 spec'] })
  })

  it('answers every operation from sample rows with Sample data, so a table needs no server', () => {
    const rows = [{ id: '1', name: 'Avery', amount: 1250 }]
    const { exports } = run({ spec: JSON.stringify(salesSpec), source: 'sample', sample_rows: JSON.stringify(rows) })
    expect(exports.operations.every((o) => o.sample)).toBe(true)
    expect(exports.sampleRows).toEqual(rows)
    const r = generate(model(inst('SwaggerDataResourceFeature', 's', { spec: JSON.stringify(salesSpec), source: 'sample', sample_rows: JSON.stringify(rows) }, null), page(), inst('TableFeature', 't', { data_resource: 's', operation: 'GET /v1/sales' })))
    expect(r.diagnostics).toEqual([])
    // Columns come from the spec's descriptions, not the rows' keys.
    expect(r.root.children[0]!.children[0]!.props).toMatchObject({
      source: { feature: 's', operation: 'GET /v1/sales', rows },
      columns: [{ field: 'id', label: 'ID of sales person' }, { field: 'name', label: 'Name of sales person' }, { field: 'amount', label: 'Total sales for sales person' }],
    })
  })

  it('makes a table on an OpenAPI list response show the whole response', () => {
    const r = generate(model(inst('SwaggerDataResourceFeature', 's', { spec: JSON.stringify(petstore3), spec_url: 'https://pets.test/openapi.json' }, null), page(), inst('TableFeature', 't', { data_resource: 's', operation: 'GET /pets' })))
    const props = r.root.children[0]!.children[0]!.props as { source: { path?: string; endPoint: string }; columns: unknown[] }
    expect(props.source.endPoint).toBe('https://pets.test/api/v3/pets')
    expect(props.source.path).toBeUndefined()
    expect(props.columns).toEqual([{ field: 'name', label: 'name' }, { field: 'tag', label: 'tag' }])
  })
})

describe('migrating the legacy Swagger resource', () => {
  it('moves the spec the legacy app kept into the stored spec, and checks references against its operations', () => {
    const r = migrate(salesSample)
    const resource = r.model.features.find((f) => f.feature === 'SwaggerDataResourceFeature')!
    expect(resource.inputs).toMatchObject({ name: 'Sales API', spec_url: 'http://sales-api.mybluemix.net/swagger_doc/sales.json' })
    expect(JSON.parse(resource.inputs.spec as string)).toEqual(salesSpec)
    expect(r.notes.map((n) => n.message)).toContain('Converted the legacy Swagger 1.2 spec to OpenAPI 3')
    expect(resource.cache).toBeUndefined()
    expect(r.notes.filter((n) => n.code === 'unresolved-operation')).toEqual([])
  })

  it('upgrades a stored v2 model that kept the legacy instance, once', () => {
    const legacy = salesSample.features.find((f: { feature: string }) => f.feature === 'SwaggerDataResourceFeature')
    const stored = { version: 2 as const, name: 'Old', features: [{ feature: 'SwaggerDataResourceFeature', id: '42', inputs: { name: 'Sales API' }, cache: { legacy } }] }
    const upgraded = migrate(stored)
    expect(upgraded.model.features[0]!.inputs).toMatchObject({ name: 'Sales API', spec_url: legacy.inputs.resource })
    expect(upgraded.model.features[0]!.cache).toBeUndefined()
    expect(upgraded.notes.map((n) => n.code)).toEqual(['coerced-value', 'upgraded-feature'])
    expect(JSON.parse(upgraded.model.features[0]!.inputs.spec as string).openapi).toBe('3.0.3')
    expect(migrate(upgraded.model).model).toBe(upgraded.model)
  })

  it('notes a legacy resource whose spec was never fetched', () => {
    const r = migrate({ features: [{ feature: 'SwaggerDataResourceFeature', id: '1', inputs: { name: 'X', resource: 'https://x.test/spec.json' } }] })
    expect(r.model.features[0]!.inputs).toEqual({ name: 'X', spec_url: 'https://x.test/spec.json', spec: '' })
    expect(r.notes.map((n) => n.message)).toContain('The legacy spec was never fetched; load an OpenAPI 3 spec from the Spec URL')
  })
})
