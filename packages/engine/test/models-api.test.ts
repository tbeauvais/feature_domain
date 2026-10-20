import { describe, expect, it } from 'vitest'
import { generate, isModelsApiAddress, newModel, proxyAddresses, validateModel, type DocNodeOf } from '../src'
import { inst, model, page } from './helpers'

// The models API on this site is the one same-site address a page may read and change data through (the home page).

describe('isModelsApiAddress', () => {
  it('takes the model list and one model under it, with or without a query', () => {
    for (const ok of ['/api/v1/models', ' /api/v1/models ', '/api/v1/models/{id}', '/api/v1/models/sample-2-1', '/api/v1/models?x=1', '/api/v1/models/a%20b'])
      expect(isModelsApiAddress(ok), ok).toBe(true)
  })

  it('refuses every other path on this site, other sites, and ways out of the models API', () => {
    for (const bad of [
      '/api/v1/proxy',
      '/api/v1/models/a/b',
      '/api/v1/modelsx',
      '/api/v1/models/..',
      '/api/v1/models/.',
      '/api/v1/models/%2e%2e',
      '/api/v1/models/%2E.',
      '/api/v1/models/a\\..\\proxy',
      '/api/v1/models/a b',
      '/api/v1/models/\t',
      '/api/v1/models#x',
      '/models/7',
      '//evil.example/api/v1/models',
      'https://example.com/api/v1/models',
      'api/v1/models',
      '',
    ])
      expect(isModelsApiAddress(bad), JSON.stringify(bad)).toBe(false)
  })
})

describe('newModel', () => {
  it('is one empty page, named as given or "Untitled model"', () => {
    expect(newModel(' Shop ')).toEqual({
      version: 2,
      name: 'Shop',
      features: [{ feature: 'PageFeature', id: '1', inputs: { name: 'Page' }, placement: { parent: '$root', slot: 'content' } }],
    })
    expect(newModel().name).toBe('Untitled model')
    expect(newModel('  ').name).toBe('Untitled model')
    expect(validateModel(newModel('x'))).toEqual([])
    expect(generate(newModel('x')).diagnostics).toEqual([])
  })
})

/** An API spec on this site: its server is a path, so its operations are too. */
const modelsSpec = (server = '/api/v1') =>
  JSON.stringify({
    openapi: '3.0.3',
    servers: [{ url: server }],
    paths: {
      '/models': { get: {}, post: { requestBody: { content: { 'application/json': { schema: { properties: { name: { type: 'string' } } } } } } } },
      '/models/{id}': { delete: { parameters: [{ name: 'id', in: 'path', required: true }] } },
    },
  })

const readsModels = (spec: string, inputs: Record<string, string> = {}) => {
  const r = generate(
    model(
      inst('SwaggerDataResourceFeature', 's', { name: 'Models API', spec, ...inputs }, null),
      page(),
      inst('TableFeature', 't', { data_resource: 's', delete_operation: 'DELETE /models/{id}' }),
      inst('FormFeature', 'f', { data_resource: 's' }),
    ),
  )
  const [table, form] = r.root.children[0]!.children as [DocNodeOf<'table'>, DocNodeOf<'form'>]
  return { table: table.props, form: form.props, problems: r.diagnostics.map((d) => d.message), model: r }
}

describe('a data resource on the models API', () => {
  it('lists, sends to and deletes from paths on this site', () => {
    const { table, form, problems } = readsModels(modelsSpec())
    expect(problems).toEqual([])
    expect(table.source).toMatchObject({ endPoint: '/api/v1/models' })
    expect(table.deleteAction).toMatchObject({ method: 'DELETE', endPoint: '/api/v1/models/{id}' })
    expect(form.action).toMatchObject({ method: 'POST', endPoint: '/api/v1/models' })
  })

  it('is always fetched by the browser: Fetch through Server leaves it alone, and the proxy is never given it', () => {
    const { table, form } = readsModels(modelsSpec(), { fetch_through: 'server' })
    expect(table.source).not.toHaveProperty('proxy')
    expect(table.deleteAction).not.toHaveProperty('proxy')
    expect(form.action).not.toHaveProperty('proxy')
    const m = model(inst('SwaggerDataResourceFeature', 's', { name: 'Models API', spec: modelsSpec(), fetch_through: 'server' }, null))
    expect(proxyAddresses(m)).toEqual([])
  })

  it('reads and sends nothing on any other path on this site', () => {
    for (const server of ['/api/v1/other', '/api', '/']) {
      const { table, form, problems } = readsModels(modelsSpec(server))
      expect(table).not.toHaveProperty('source')
      expect(form).not.toHaveProperty('action')
      expect(problems).toContain('Operation "GET /models" of Models API has no http(s) URL')
    }
  })
})
