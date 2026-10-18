import { describe, expect, it } from 'vitest'
import { defaultRegistry, generate, proxyAddresses, type DocNodeOf } from '../src'
import { inst, model, page } from './helpers'

const spec = JSON.stringify({
  openapi: '3.0.3',
  servers: [{ url: 'https://pets.test/v1' }],
  paths: { '/pets': { get: {}, post: { requestBody: { content: { 'application/json': { schema: { properties: { name: { type: 'string' } } } } } } } } },
})
const address = (id: string, url: string, inputs = {}) => inst('DataResourceFeature', id, { name: id, resource: url, ...inputs }, null)
const apiSpec = (id: string, inputs = {}) =>
  inst('SwaggerDataResourceFeature', id, { name: id, spec, spec_url: 'https://docs.pets.test/openapi.json', ...inputs }, null)

describe('proxyAddresses', () => {
  it("lists only the addresses of resources fetched through the server, and an API spec's Spec URL", () => {
    const m = model(
      address('a', 'https://api.example.com/repos', { fetch_through: 'server' }),
      address('b', 'https://other.example.com/rows'),
      address('c', 'https://browser.example.com/rows', { fetch_through: 'browser' }),
      apiSpec('s', { fetch_through: 'server' }),
      apiSpec('t'),
    )
    expect(proxyAddresses(m).sort()).toEqual(['https://api.example.com/repos', 'https://docs.pets.test/openapi.json', 'https://pets.test/v1/pets'])
  })

  it('lists no operations of a resource answering with sample data, but still its Spec URL', () => {
    const m = model(
      address('a', 'https://api.example.com/repos', { fetch_through: 'server', source: 'sample' }),
      apiSpec('s', { fetch_through: 'server', source: 'sample' }),
    )
    expect(proxyAddresses(m)).toEqual(['https://docs.pets.test/openapi.json'])
  })

  it('lists nothing for an unrecognized Fetch through, or a feature type that is not a data resource', () => {
    expect(proxyAddresses(model(address('a', 'https://api.example.com/repos', { fetch_through: 'proxy' })))).toEqual([])
    expect(proxyAddresses(model(inst('UnknownFeature', 'x', { fetch_through: 'server', resource: 'https://x.test' }, null)))).toEqual([])
  })
})

describe('Fetch through', () => {
  const read = (fetchThrough?: string) => {
    const inputs = fetchThrough ? { fetch_through: fetchThrough } : {}
    const r = generate(
      model(
        address('r', 'https://api.example.com/repos', inputs),
        apiSpec('s', inputs),
        page(),
        inst('TableFeature', 't', { data_resource: 'r' }),
        inst('FormFeature', 'f', { data_resource: 's' }),
      ),
    )
    const [table, form] = r.root.children[0]!.children as [DocNodeOf<'table'>, DocNodeOf<'form'>]
    return { source: table.props.source, action: form.props.action, problems: r.diagnostics }
  }

  it('marks the sources and actions of a resource fetched through the server', () => {
    const { source, action, problems } = read('server')
    expect(problems).toEqual([])
    expect(source).toMatchObject({ endPoint: 'https://api.example.com/repos', proxy: true })
    expect(action).toMatchObject({ endPoint: 'https://pets.test/v1/pets', method: 'POST', proxy: true })
  })

  it('leaves them to the browser by default', () => {
    for (const fetchThrough of [undefined, 'browser', 'nonsense']) {
      const { source, action } = read(fetchThrough)
      expect(source).not.toHaveProperty('proxy')
      expect(action).not.toHaveProperty('proxy')
    }
  })

  it('never marks sample data, which the browser answers', () => {
    const r = generate(
      model(
        apiSpec('s', { fetch_through: 'server', source: 'sample', sample_rows: '[{"name": "Rex"}]' }),
        page(),
        inst('TableFeature', 't', { data_resource: 's' }),
        inst('FormFeature', 'f', { data_resource: 's' }),
      ),
    )
    const [table, form] = r.root.children[0]!.children as [DocNodeOf<'table'>, DocNodeOf<'form'>]
    expect(table.props.source).not.toHaveProperty('proxy')
    expect(form.props.action).toMatchObject({ sample: true })
    expect(form.props.action).not.toHaveProperty('proxy')
  })
})

describe('Fetch through', () => {
  it("commits a Data Resource's address when the field is left, so a partial one is never fetched", () => {
    const def = defaultRegistry.get('DataResourceFeature')!
    expect(def.inputs.find((i) => i.name === 'resource')?.commitOnBlur).toBe(true)
  })
})
