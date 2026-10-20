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

  it('is left out of the model list', async () => {
    await request('/api/v1/home/reset', { method: 'POST' })
    const { id } = (await (await request('/api/v1/models', json({ name: 'Mine' }))).json()) as { id: string }
    expect(((await (await request('/api/v1/models')).json()) as { id: string }[]).map((m) => m.id)).toEqual([id])
    expect((await request(`/api/v1/models/${HOME_ID}`)).status).toBe(200)
  })
})

describe('POST /api/v1/home/reset', () => {
  it('stores the built-in home model when there is none, and puts it back over a changed one', async () => {
    const created = await request('/api/v1/home/reset', { method: 'POST' })
    expect(created.status).toBe(204)
    expect(created.headers.get('ETag')).toBe('"1"')
    expect(await (await request(`/api/v1/models/${HOME_ID}`)).json()).toEqual({ ...homeModel(), id: HOME_ID })

    await request(`/api/v1/models/${HOME_ID}`, json({ version: 2, name: 'Broken', features: [] }, 'PUT'))
    const reset = await request('/api/v1/home/reset', { method: 'POST' })
    expect(reset.headers.get('ETag')).toBe('"3"')
    const stored = await request(`/api/v1/models/${HOME_ID}`)
    expect(await stored.json()).toEqual({ ...homeModel(), id: HOME_ID })
    expect(stored.headers.get('ETag')).toBe('"3"')
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
