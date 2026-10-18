import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  ApiSpecFeature,
  generate,
  initialInputs,
  MAX_SPEC_CHARS,
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
    expect(r.operations[0]).toMatchObject({
      method: 'GET',
      endPoint: 'http://sales-api.mybluemix.net/v1/sales',
      responseType: 'Sales',
      summary: 'List of sales',
    })
    expect(r.operations[1]!.parameters).toEqual([
      { name: 'name', in: 'form', type: 'string', description: 'Name of sales person.', required: false },
      { name: 'amount', in: 'form', type: 'number', description: 'Total sales for sales person.', required: false },
    ])
    expect(r.operations[2]!.parameters).toEqual([{ name: 'id', in: 'path', type: 'string', description: 'Sales record id', required: true }])
    expect(r.schemas.Sales).toEqual({
      type: 'object',
      properties: {
        count: { type: 'integer', description: 'Total number of sales.' },
        sales: { type: 'array', description: 'All sales.', items: { $ref: 'Sale' } },
      },
    })
  })

  it('reads OpenAPI 3.1 types that allow null', () => {
    const spec = { openapi: '3.1.0', paths: {}, components: { schemas: { Pet: { type: 'object', properties: { tag: { type: ['string', 'null'] } } } } } }
    expect(read(spec).schemas.Pet).toEqual({ type: 'object', properties: { tag: { type: 'string' } } })
  })

  it('reads OpenAPI 3, resolving a relative server against the spec address', () => {
    const r = read(petstore3, 'https://pets.test/docs/openapi.json')
    expect(r.format).toBe('OpenAPI 3.0.3')
    expect(r.operations.map((o) => o.endPoint)).toEqual(['https://pets.test/api/v3/pets', 'https://pets.test/api/v3/pets'])
    expect(read({ ...petstore3, servers: [{ url: 'v2/' }] }, 'https://pets.test/docs/openapi.json').operations[0]!.endPoint).toBe(
      'https://pets.test/docs/v2/pets',
    )
    expect(r.operations[1]!.parameters?.map((p) => p.name)).toEqual(['name', 'tag'])
  })

  it("uses the spec's own site when there is no server, fills in server variables, and resolves protocol-relative servers", () => {
    const at = (servers: unknown, specUrl = 'https://pets.test/docs/openapi.json') => read({ ...petstore3, servers }, specUrl).operations[0]!.endPoint
    expect(at(undefined)).toBe('https://pets.test/pets')
    expect(at([])).toBe('https://pets.test/pets')
    expect(at([{ url: 5 }])).toBe('https://pets.test/pets')
    expect(at([{ url: 'https://{env}.pets.test/v{ver}', variables: { env: { default: 'api' }, ver: { enum: ['2', '3'] } } }])).toBe(
      'https://api.pets.test/v2/pets',
    )
    expect(at([{ url: '//cdn.pets.test/v1' }], 'http://pets.test/openapi.json')).toBe('http://cdn.pets.test/v1/pets')
    expect(at([{ url: '/' }], '')).toBe('/pets')
  })

  it('follows shared parameters, request bodies and responses, any success response and any JSON media type', () => {
    const spec = {
      openapi: '3.0.3',
      components: {
        schemas: { Item: { type: 'object', properties: { id: { type: 'integer' } } } },
        parameters: { Limit: { name: 'limit', in: 'query', schema: { type: 'integer' } }, Session: { name: 's', in: 'cookie' } },
        requestBodies: { NewItem: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } } } },
        responses: {
          Items: {
            description: 'ok',
            content: { 'application/vnd.example+json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Item' } } } },
          },
        },
      },
      paths: {
        '/a': {
          parameters: [{ name: 'limit', in: 'query', schema: { type: 'string' } }],
          get: {
            parameters: [{ $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Session' }],
            responses: { '2XX': { $ref: '#/components/responses/Items' } },
          },
          post: {
            requestBody: { $ref: '#/components/requestBodies/NewItem' },
            responses: { default: { description: 'x', content: { 'application/json; charset=utf-8': { schema: { $ref: '#/components/schemas/Item' } } } } },
          },
        },
        '/loop': { get: { parameters: [{ $ref: '#/components/parameters/Loop' }], responses: { '204': {} } } },
      },
    }
    ;(spec.components.parameters as Record<string, unknown>).Loop = { $ref: '#/components/parameters/Loop' }
    const r = read(spec, 'https://x.test/openapi.json')
    const [get, post, loop] = r.operations
    // The operation's own "limit" (an integer) replaces the path's (a string); the cookie is left out.
    expect(get!.parameters).toEqual([{ name: 'limit', in: 'query', type: 'integer', description: '', required: false }])
    expect(r.schemas[get!.responseType!]).toEqual({ type: 'array', items: { $ref: 'Item' } })
    // The POST inherits the path's "limit", then takes the body's fields.
    expect(post!.parameters?.map((p) => p.name)).toEqual(['limit', 'id'])
    expect(post!.responseType).toBe('Item')
    expect(loop!.parameters).toBeUndefined()
  })

  it('gives inline list items a schema of their own, so a table gets columns', () => {
    const spec = {
      openapi: '3.0.0',
      paths: {
        '/pets': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': { schema: { type: 'array', items: { type: 'object', properties: { name: { type: 'string', description: 'Name.' } } } } },
                },
              },
            },
          },
        },
      },
    }
    const r = generate(
      model(
        inst('SwaggerDataResourceFeature', 's', { spec: JSON.stringify(spec), spec_url: 'https://pets.test/openapi.json' }, null),
        page(),
        inst('TableFeature', 't', { data_resource: 's' }),
      ),
    )
    expect(r.root.children[0]!.children[0]!.props).toMatchObject({
      source: { endPoint: 'https://pets.test/pets' },
      columns: [{ field: 'name', label: 'Name' }],
    })
  })

  it('lists the first GET when a table has no operation chosen, whatever order the spec gives', () => {
    const spec = { openapi: '3.0.0', servers: [{ url: 'https://pets.test' }], paths: { '/pets': { post: {}, get: {} } } }
    const r = generate(
      model(inst('SwaggerDataResourceFeature', 's', { spec: JSON.stringify(spec) }, null), page(), inst('TableFeature', 't', { data_resource: 's' })),
    )
    expect(r.root.children[0]!.children[0]!.props).toMatchObject({ source: { operation: 'GET /pets' } })
    const postOnly = { ...spec, paths: { '/pets': { post: {} } } }
    const p = generate(
      model(
        inst('SwaggerDataResourceFeature', 's', { name: 'Pets', spec: JSON.stringify(postOnly) }, null),
        page(),
        inst('TableFeature', 't', { data_resource: 's' }),
      ),
    )
    expect(p.diagnostics.map((d) => d.message)).toContain('Pets has no GET operation to list rows from')
  })

  it('refuses a spec too large to store', () => {
    const huge = JSON.stringify({ openapi: '3.0.0', paths: {}, info: { description: 'x'.repeat(MAX_SPEC_CHARS) } })
    const report = vi.fn<FeatureContext['report']>()
    const out = ApiSpecFeature.generate({ ...initialInputs(ApiSpecFeature.inputs), spec: huge } as never, {
      instanceId: 's',
      nodeId: () => 's',
      resolve: () => undefined,
      report,
    })
    expect((out.exports as unknown as DataResourceExports).operations).toEqual([])
    expect(report.mock.calls[0]![1]).toMatch(/^The spec is too large \(1\.0 MB; at most 1 MB/)
  })

  it('says what is wrong with something that is not a spec, and never follows prototype keys', () => {
    expect(readApiSpec([1, 2])).toEqual({ problem: 'The spec is not a JSON object' })
    expect(readApiSpec({ hello: 'world' })).toEqual({ problem: 'Not an OpenAPI 3 spec' })
    // Older Swagger specs aren't read: they say how to get one that is.
    for (const old of [{ swagger: '2.0', paths: {} }, salesSwagger12])
      expect(readApiSpec(old)).toEqual({ problem: 'Only OpenAPI 3 specs are read; convert this Swagger spec to OpenAPI 3 first' })
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

  it("exports the stored spec's operations and schemas", () => {
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
    const r = generate(
      model(
        inst('SwaggerDataResourceFeature', 's', { spec: JSON.stringify(salesSpec), source: 'sample', sample_rows: JSON.stringify(rows) }, null),
        page(),
        inst('TableFeature', 't', { data_resource: 's', operation: 'GET /v1/sales' }),
      ),
    )
    expect(r.diagnostics).toEqual([])
    // Columns come from the spec's descriptions, not the rows' keys.
    expect(r.root.children[0]!.children[0]!.props).toMatchObject({
      source: { feature: 's', operation: 'GET /v1/sales', rows },
      columns: [
        { field: 'id', label: 'ID of sales person' },
        { field: 'name', label: 'Name of sales person' },
        { field: 'amount', label: 'Total sales for sales person' },
      ],
    })
  })

  it("applies a table's Labels and Filters to a spec's columns in order when it has no Fields", () => {
    const rows = [{ id: '1', name: 'Avery', amount: 18250 }]
    const r = generate(
      model(
        inst('SwaggerDataResourceFeature', 's', { spec: JSON.stringify(salesSpec), source: 'sample', sample_rows: JSON.stringify(rows) }, null),
        page(),
        inst('TableFeature', 't', { data_resource: 's', operation: 'GET /v1/sales', labels: ['', 'Who'], filters: ['', '', 'currency'] }),
      ),
    )
    expect(r.root.children[0]!.children[0]!.props).toMatchObject({
      columns: [
        { field: 'id', label: 'ID of sales person' },
        { field: 'name', label: 'Who' },
        { field: 'amount', label: 'Total sales for sales person', filter: 'currency' },
      ],
    })
  })

  it('leaves Labels and Filters for the renderer when the columns are only known once rows load', () => {
    const feed = inst('DataResourceFeature', 'g', { name: 'Feed', resource: 'https://x.test/feed' }, null)
    const table = (inputs: Record<string, unknown>) =>
      generate(model(feed, page(), inst('TableFeature', 't', { data_resource: 'g', ...inputs } as never))).root.children[0]!.children[0]!.props
    expect(table({ labels: ['Who'], filters: ['', 'currency'] })).toMatchObject({ columns: [], byPosition: { labels: ['Who'], filters: ['', 'currency'] } })
    expect(table({})).not.toHaveProperty('byPosition')
    // Its own Fields carry their labels and filters already.
    expect(table({ fields: ['name'], labels: ['Who'] })).not.toHaveProperty('byPosition')
  })

  it('makes a table on an OpenAPI list response show the whole response', () => {
    const r = generate(
      model(
        inst('SwaggerDataResourceFeature', 's', { spec: JSON.stringify(petstore3), spec_url: 'https://pets.test/openapi.json' }, null),
        page(),
        inst('TableFeature', 't', { data_resource: 's', operation: 'GET /pets' }),
      ),
    )
    const props = r.root.children[0]!.children[0]!.props as { source: { path?: string; endPoint: string }; columns: unknown[] }
    expect(props.source.endPoint).toBe('https://pets.test/api/v3/pets')
    expect(props.source.path).toBeUndefined()
    expect(props.columns).toEqual([
      { field: 'name', label: 'name' },
      { field: 'tag', label: 'tag' },
    ])
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
    const stored = {
      version: 2 as const,
      name: 'Old',
      features: [{ feature: 'SwaggerDataResourceFeature', id: '42', inputs: { name: 'Sales API' }, cache: { legacy } }],
    }
    const upgraded = migrate(stored)
    expect(upgraded.model.features[0]!.inputs).toMatchObject({ name: 'Sales API', spec_url: legacy.inputs.resource })
    expect(upgraded.model.features[0]!.cache).toBeUndefined()
    expect(upgraded.notes.map((n) => n.code)).toEqual(['coerced-value', 'upgraded-feature'])
    expect(JSON.parse(upgraded.model.features[0]!.inputs.spec as string).openapi).toBe('3.0.3')
    expect(migrate(upgraded.model).model).toBe(upgraded.model)
  })

  it('keeps a cached spec it cannot convert, saying so', () => {
    const swagger2 = { swagger: '2.0', paths: {} }
    const r = migrate({
      features: [{ feature: 'SwaggerDataResourceFeature', id: '1', inputs: { name: 'X', resource: 'https://x.test/spec.json' }, cache: { swagger: swagger2 } }],
    })
    expect(r.model.features[0]!.inputs.spec).toBe('')
    expect(r.model.features[0]!.cache).toEqual({ swagger: swagger2 })
    expect(r.notes.map((n) => n.message)).toContain(
      'The legacy cached spec is not Swagger 1.2, so it was not converted (it stays in the cache); load an OpenAPI 3 spec from the Spec URL',
    )
  })

  it('notes a legacy resource whose spec was never fetched', () => {
    const r = migrate({ features: [{ feature: 'SwaggerDataResourceFeature', id: '1', inputs: { name: 'X', resource: 'https://x.test/spec.json' } }] })
    expect(r.model.features[0]!.inputs).toEqual({ name: 'X', spec_url: 'https://x.test/spec.json', spec: '' })
    expect(r.notes.map((n) => n.message)).toContain('The legacy spec was never fetched; load an OpenAPI 3 spec from the Spec URL')
  })
})
