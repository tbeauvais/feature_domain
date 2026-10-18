import { expect, test } from '@playwright/test'

// The model API as deployed: the built Worker in workerd, on a local D1 database migrated by wrangler.

const model = {
  version: 2,
  name: 'API round trip',
  features: [{ feature: 'PageFeature', id: '1', inputs: { name: 'Home' }, placement: { parent: '$root', slot: 'content' } }],
}

test('stores, reads, updates and deletes models', async ({ request }) => {
  const created = await request.post('/api/v1/models', { data: model })
  expect(created.status()).toBe(201)
  const { id } = (await created.json()) as { id: string }

  expect(await (await request.get('/api/v1/models')).json()).toContainEqual({ id, name: 'API round trip' })
  expect(await (await request.get(`/api/v1/models/${id}`)).json()).toEqual({ ...model, id })

  expect((await request.put(`/api/v1/models/${id}`, { data: { ...model, name: 'Renamed' } })).status()).toBe(204)
  expect(await (await request.get(`/api/v1/models/${id}`)).json()).toMatchObject({ name: 'Renamed' })

  expect((await request.delete(`/api/v1/models/${id}`)).status()).toBe(204)
  expect((await request.get(`/api/v1/models/${id}`)).status()).toBe(404)
})

test('versions saves, refusing one made from an older version', async ({ request }) => {
  const created = await request.post('/api/v1/models', { data: model })
  expect(created.headers()['etag']).toBe('"1"')
  const { id } = (await created.json()) as { id: string }
  const path = `/api/v1/models/${id}`

  const saved = await request.put(path, { data: { ...model, name: 'Theirs' }, headers: { 'If-Match': '"1"' } })
  expect(saved.status()).toBe(204)
  expect(saved.headers()['etag']).toBe('"2"')
  const stale = await request.put(path, { data: { ...model, name: 'Mine' }, headers: { 'If-Match': '"1"' } })
  expect(stale.status()).toBe(412)
  expect(stale.headers()['etag']).toBe('"2"')

  expect((await request.get(path, { headers: { 'If-None-Match': '"2"' } })).status()).toBe(304)
  const read = await request.get(path, { headers: { 'If-None-Match': '"1"' } })
  expect(read.status()).toBe(200)
  expect(await read.json()).toMatchObject({ name: 'Theirs' })

  await request.delete(path)
})

test('refuses invalid models', async ({ request }) => {
  const response = await request.post('/api/v1/models', { data: { ...model, version: 1 } })
  expect(response.status()).toBe(400)
  expect(await response.json()).toMatchObject({ problems: ['Unsupported model version 1'] })
})

test('answers unknown API paths with JSON, and editor paths with the editor', async ({ request }) => {
  const api = await request.get('/api/app_features')
  expect(api.status()).toBe(404)
  expect(await api.json()).toEqual({ error: 'No such API endpoint' })

  const editor = await request.get('/models/some-id', { headers: { 'Sec-Fetch-Mode': 'navigate', Accept: 'text/html' } })
  expect(editor.status()).toBe(200)
  expect(await editor.text()).toContain('<div id="app">')
})
