import { MemoryModelStore, type AppModel } from '@feature-domain/engine'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp, MAX_MODEL_BYTES } from '../src/app'
import { localD1, type LocalD1 } from './localD1'

const model: AppModel = {
  version: 2,
  name: 'Harbor Coffee',
  features: [{ feature: 'PageFeature', id: '1', inputs: { name: 'Home' }, placement: { parent: '$root', slot: 'content' } }],
}

const json = (body: unknown, method = 'POST', headers: Record<string, string> = {}): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json', ...headers },
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

  it('refuses a large declared Content-Length before reading the body', async () => {
    const init = json(model)
    const response = await request('/api/v1/models', { ...init, headers: { ...init.headers, 'Content-Length': String(MAX_MODEL_BYTES + 1) } })
    expect(response.status).toBe(413)
  })

  // Local D1 doesn't enforce Cloudflare's 2,000,000-byte rows, so these check the stored row's size themselves.
  const rowBytes = (id: string) =>
    d1.env.DB.prepare('SELECT length(CAST(model AS BLOB)) + length(CAST(name AS BLOB)) AS n FROM models WHERE id = ?').bind(id).first<number>('n')

  /** `model` with a Text whose input pads its stored JSON to exactly `size` bytes. */
  function padded(size: number, name = model.name): AppModel {
    const base: AppModel = { ...model, name, features: [...model.features, { feature: 'TextFeature', id: '2', inputs: { text: '' }, placement: { parent: '1', slot: 'content' } }] }
    const text = 'x'.repeat(size - JSON.stringify(base).length)
    return { ...base, features: [model.features[0]!, { ...base.features[1]!, inputs: { text } }] }
  }

  it('stores the largest accepted model, within a D1 row', async () => {
    const largest = padded(MAX_MODEL_BYTES - model.name.length)
    const response = await request('/api/v1/models', json(largest))
    expect(response.status).toBe(201)
    const { id } = (await response.json()) as { id: string }
    expect(await rowBytes(id)).toBe(MAX_MODEL_BYTES)
  })

  it('counts the name, which is stored twice, against the limit', async () => {
    const name = 'n'.repeat(500_000)
    const response = await request('/api/v1/models', json(padded(MAX_MODEL_BYTES - 400_000, name)))
    expect(response.status).toBe(413)
    expect(await (await request('/api/v1/models')).json()).toEqual([])
  })
})

describe('model versions', () => {
  async function created(): Promise<string> {
    return ((await (await request('/api/v1/models', json(model))).json()) as { id: string }).id
  }
  const put = (id: string, name: string, ifMatch?: string) =>
    request(`/api/v1/models/${id}`, json({ ...model, name }, 'PUT', ifMatch === undefined ? {} : { 'If-Match': ifMatch }))

  it('gives each version of a model as its ETag, starting at 1', async () => {
    const response = await request('/api/v1/models', json(model))
    expect(response.headers.get('ETag')).toBe('"1"')
    const { id } = (await response.json()) as { id: string }
    const read = await request(`/api/v1/models/${id}`)
    expect(read.headers.get('ETag')).toBe('"1"')
    expect(read.headers.get('Cache-Control')).toBe('no-cache')
    const saved = await put(id, 'Harbor Tea')
    expect(saved.status).toBe(204)
    expect(saved.headers.get('ETag')).toBe('"2"')
    expect((await request(`/api/v1/models/${id}`)).headers.get('ETag')).toBe('"2"')
  })

  it('saves over the version If-Match names', async () => {
    const id = await created()
    const first = await put(id, 'Mine', '"1"')
    expect(first.status).toBe(204)
    expect(first.headers.get('ETag')).toBe('"2"')
    expect((await put(id, 'Mine again', '"2"')).headers.get('ETag')).toBe('"3"')
    expect(await (await request(`/api/v1/models/${id}`)).json()).toMatchObject({ name: 'Mine again' })
  })

  it('refuses a save made from an older version with a 412 naming the stored one, and keeps what is stored', async () => {
    const id = await created()
    await put(id, 'Theirs', '"1"')
    const refused = await put(id, 'Mine', '"1"')
    expect(refused.status).toBe(412)
    expect(refused.headers.get('ETag')).toBe('"2"')
    expect(await refused.json()).toEqual({ error: 'The model was changed since this version' })
    expect(await (await request(`/api/v1/models/${id}`)).json()).toMatchObject({ name: 'Theirs' })
  })

  it('takes If-Match: * as any stored version, and a missing model is still a 404', async () => {
    const id = await created()
    expect((await put(id, 'Any', '*')).status).toBe(204)
    expect((await put('nope', 'Any', '*')).status).toBe(404)
    expect((await put('nope', 'Any', '"1"')).status).toBe(404)
  })

  it('refuses If-Match values it never sends, before reading the model', async () => {
    const id = await created()
    for (const value of ['W/"1"', '"1", "2"', '1', '"0"', '"abc"', '']) {
      const response = await put(id, 'Bad', value)
      expect(response.status, value).toBe(400)
    }
    expect(await (await request(`/api/v1/models/${id}`)).json()).toMatchObject({ name: model.name })
  })

  it('answers If-None-Match with a 304 while the model is unchanged', async () => {
    const id = await created()
    const unchanged = await request(`/api/v1/models/${id}`, { headers: { 'If-None-Match': '"1"' } })
    expect(unchanged.status).toBe(304)
    expect(unchanged.headers.get('ETag')).toBe('"1"')
    expect(await unchanged.text()).toBe('')
    for (const value of ['W/"1"', '"7", "1"', '*']) {
      expect((await request(`/api/v1/models/${id}`, { headers: { 'If-None-Match': value } })).status, value).toBe(304)
    }
    await put(id, 'Changed')
    const changed = await request(`/api/v1/models/${id}`, { headers: { 'If-None-Match': '"1"' } })
    expect(changed.status).toBe(200)
    expect(changed.headers.get('ETag')).toBe('"2"')
    expect(await changed.json()).toMatchObject({ name: 'Changed' })
    expect((await request('/api/v1/models/nope', { headers: { 'If-None-Match': '"1"' } })).status).toBe(404)
  })
})

describe('the API', () => {
  it('answers methods a model path does not support with a 405', async () => {
    for (const [path, allow] of [['/api/v1/models', 'GET, POST'], ['/api/v1/models/1', 'GET, PUT, DELETE']] as const) {
      const response = await request(path, { method: 'PATCH' })
      expect(response.status, path).toBe(405)
      expect(response.headers.get('Allow')).toBe(allow)
      expect(await response.json()).toEqual({ error: 'Method not allowed' })
    }
  })

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
