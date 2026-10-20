import { generate, readApiSpec, validateModel, type AppModel, type ReadSpec } from '@feature-domain/engine'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { HOME_ID, homeModel } from '../src/home'
import { MODELS_API_SPEC } from '../src/openapi'
import { localD1, type LocalD1 } from './localD1'

const json = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

let d1: LocalD1
beforeAll(async () => {
  d1 = await localD1()
}, 60_000)
afterAll(() => d1?.dispose())
beforeEach(() => d1.env.DB.exec('DELETE FROM models'))

const app = createApp()
const request = (path: string, init?: RequestInit) => app.request(path, init, d1.env)
const reset = () => request('/api/v1/home/reset', json({}))

describe('the home model', () => {
  it('generates with no problems at all', () => {
    const model = homeModel()
    expect(validateModel(model)).toEqual([])
    expect(generate(model).diagnostics).toEqual([])
  })

  it('stores the spec the API serves, which reads as the models API on this site', async () => {
    const spec = homeModel().features.find((f) => f.feature === 'SwaggerDataResourceFeature')!.inputs.spec as string
    expect(JSON.parse(spec)).toEqual(await (await request('/api/v1/openapi.json')).json())
    const read = readApiSpec(MODELS_API_SPEC) as ReadSpec
    expect(read.operations.map((o) => [o.name, o.endPoint])).toEqual([
      ['GET /models', '/api/v1/models'],
      ['POST /models', '/api/v1/models'],
      ['GET /models/{id}', '/api/v1/models/{id}'],
      ['PUT /models/{id}', '/api/v1/models/{id}'],
      ['DELETE /models/{id}', '/api/v1/models/{id}'],
    ])
  })

  it('describes exactly the methods the routes take', async () => {
    // The home model stores a copy of this spec, so a route that changed without it would leave the home page wrong.
    const paths = MODELS_API_SPEC.paths as Record<string, Record<string, unknown>>
    const methods = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace']
    for (const [path, item] of Object.entries(paths)) {
      const url = '/api/v1' + path.replace('{id}', 'any')
      const allow = (await request(url, { method: 'PATCH' })).headers.get('Allow')
      const described = Object.keys(item).filter((key) => methods.includes(key))
      expect(
        allow
          ?.split(', ')
          .map((m) => m.toLowerCase())
          .sort(),
        path,
      ).toEqual(described.sort())
    }
  })

  it('is left out of the model list', async () => {
    await reset()
    const { id } = (await (await request('/api/v1/models', json({ name: 'Mine' }))).json()) as { id: string }
    expect(((await (await request('/api/v1/models')).json()) as { id: string }[]).map((m) => m.id)).toEqual([id])
    expect((await request(`/api/v1/models/${HOME_ID}`)).status).toBe(200)
  })
})

describe('POST /api/v1/home/reset', () => {
  it('stores the built-in home model when there is none, and puts it back over a changed one', async () => {
    const created = await reset()
    expect(created.status).toBe(204)
    expect(created.headers.get('ETag')).toBe('"1"')
    expect(await (await request(`/api/v1/models/${HOME_ID}`)).json()).toEqual({ ...homeModel(), id: HOME_ID })

    await request(`/api/v1/models/${HOME_ID}`, json({ version: 2, name: 'Broken', features: [] }, 'PUT'))
    const again = await reset()
    expect(again.headers.get('ETag')).toBe('"3"')
    const stored = await request(`/api/v1/models/${HOME_ID}`)
    expect(await stored.json()).toEqual({ ...homeModel(), id: HOME_ID })
    expect(stored.headers.get('ETag')).toBe('"3"')
  })

  it('refuses anything but application/json, so a form on another site cannot send it', async () => {
    await reset()
    await request(`/api/v1/models/${HOME_ID}`, json({ version: 2, name: 'Mine', features: [] }, 'PUT'))
    for (const init of [
      { method: 'POST' },
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a=1' },
      { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' },
    ]) {
      const response = await request('/api/v1/home/reset', init)
      expect(response.status).toBe(415)
      expect(await response.json()).toEqual({ error: 'Send the request as application/json' })
    }
    expect(((await (await request(`/api/v1/models/${HOME_ID}`)).json()) as AppModel).name).toBe('Mine')
  })
})

describe('POST /api/v1/models with a name alone', () => {
  it('starts a model with one empty page, as a form sends it', async () => {
    const created = await request('/api/v1/models', json({ name: '  Shop  ' }))
    expect(created.status).toBe(201)
    const { id } = (await created.json()) as { id: string }
    const model = (await (await request(`/api/v1/models/${id}`)).json()) as AppModel
    expect(model).toMatchObject({ id, version: 2, name: 'Shop', features: [{ feature: 'PageFeature', id: '1' }] })
    expect(model.features).toHaveLength(1)
  })

  it('refuses a missing or empty name, and a body that is part model', async () => {
    for (const body of [{ name: '' }, { name: '   ' }, { name: 3 }]) {
      const response = await request('/api/v1/models', json(body))
      expect(response.status, JSON.stringify(body)).toBe(400)
      expect(await response.json()).toEqual({ error: 'The model is not valid', problems: ['Give the model a name'] })
    }
    // With a version or features, it is a whole model and is checked as one.
    expect((await request('/api/v1/models', json({ name: 'x', features: [] }))).status).toBe(400)
    expect((await request('/api/v1/models', json({}))).status).toBe(400)
    expect(await (await request('/api/v1/models')).json()).toEqual([])
  })

  it('is only for creating: an update needs the whole model', async () => {
    const { id } = (await (await request('/api/v1/models', json({ name: 'Shop' }))).json()) as { id: string }
    expect((await request(`/api/v1/models/${id}`, json({ name: 'Renamed' }, 'PUT'))).status).toBe(400)
  })
})
