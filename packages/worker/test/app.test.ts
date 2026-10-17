import { MemoryModelStore, type AppModel } from '@feature-domain/engine'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp, MAX_MODEL_BYTES } from '../src/app'
import { localD1, type LocalD1 } from './localD1'

const model: AppModel = {
  version: 2,
  name: 'Harbor Coffee',
  features: [{ feature: 'PageFeature', id: '1', inputs: { name: 'Home' }, placement: { parent: '$root', slot: 'content' } }],
}

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})

let d1: LocalD1
beforeAll(async () => {
  d1 = await localD1()
}, 60_000)
afterAll(() => d1?.dispose())
beforeEach(() => d1.env.DB.exec('DELETE FROM models'))

// The routes run against the real local D1 (through workerd); e2e/api.spec.ts in packages/web runs them in workerd too.
const app = createApp()
const request = (path: string, init?: RequestInit) => app.request(path, init, d1.env)

describe('/api/v1/models', () => {
  it('creates, lists, reads, updates and deletes models', async () => {
    expect(await (await request('/api/v1/models')).json()).toEqual([])

    const created = await request('/api/v1/models', json(model))
    expect(created.status).toBe(201)
    const { id } = (await created.json()) as { id: string }
    expect(created.headers.get('Location')).toBe(`/api/v1/models/${id}`)

    expect(await (await request('/api/v1/models')).json()).toEqual([{ id, name: 'Harbor Coffee' }])
    expect(await (await request(`/api/v1/models/${id}`)).json()).toEqual({ ...model, id })

    const updated = await request(`/api/v1/models/${id}`, json({ ...model, name: 'Harbor Tea' }, 'PUT'))
    expect(updated.status).toBe(204)
    expect(await (await request(`/api/v1/models/${id}`)).json()).toMatchObject({ id, name: 'Harbor Tea' })

    expect((await request(`/api/v1/models/${id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await request(`/api/v1/models/${id}`)).status).toBe(404)
  })

  it('answers 404 for missing models, and deleting one is not an error', async () => {
    const get = await request('/api/v1/models/nope')
    expect(get.status).toBe(404)
    expect(await get.json()).toEqual({ error: 'No model with this id' })
    expect((await request('/api/v1/models/nope', json(model, 'PUT'))).status).toBe(404)
    expect((await request('/api/v1/models/nope', { method: 'DELETE' })).status).toBe(204)
  })

  it('refuses invalid models with the problems found', async () => {
    const response = await request('/api/v1/models', json({ version: 1, name: 3, features: [] }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'The model is not valid',
      problems: ['Unsupported model version 1', 'Model name is not a string'],
    })
    expect((await request('/api/v1/models', json('{"version":'))).status).toBe(400)
    expect(await (await request('/api/v1/models')).json()).toEqual([])
  })

  it('refuses invalid updates and keeps the stored model', async () => {
    const { id } = (await (await request('/api/v1/models', json(model))).json()) as { id: string }
    expect((await request(`/api/v1/models/${id}`, json({ ...model, features: 'none' }, 'PUT'))).status).toBe(400)
    expect(await (await request(`/api/v1/models/${id}`)).json()).toEqual({ ...model, id })
  })

  it('needs a JSON content type', async () => {
    const response = await request('/api/v1/models', { method: 'POST', body: JSON.stringify(model) })
    expect(response.status).toBe(415)
  })

  it('refuses models larger than a D1 row holds', async () => {
    const big = { ...model, name: 'x'.repeat(MAX_MODEL_BYTES) }
    const response = await request('/api/v1/models', json(big))
    expect(response.status).toBe(413)
    expect(await (await request('/api/v1/models')).json()).toEqual([])
  })

  it('stores the largest accepted model', async () => {
    const name = 'x'.repeat(MAX_MODEL_BYTES - JSON.stringify(model).length + model.name.length)
    const response = await request('/api/v1/models', json({ ...model, name }))
    expect(response.status).toBe(201)
  })
})

describe('the API', () => {
  it('answers unknown endpoints with JSON 404s', async () => {
    for (const path of ['/api/v1/nope', '/api/app_features', '/api/v2/models']) {
      const response = await request(path)
      expect(response.status, path).toBe(404)
      expect(await response.json()).toEqual({ error: 'No such API endpoint' })
    }
  })

  it('answers failures with a JSON 500 that reveals nothing', async () => {
    const failing = new MemoryModelStore()
    failing.list = () => Promise.reject(new Error('secret detail'))
    const response = await createApp(() => failing).request('/api/v1/models', undefined, d1.env)
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('secret')
  })
})
