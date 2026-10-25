import { expect, test } from '@playwright/test'
import { isCspViolation } from './network'

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

  expect(await (await request.get('/api/v1/models')).json()).toContainEqual({ id, name: 'API round trip', updated_at: expect.any(String) })
  expect(await (await request.get(`/api/v1/models/${id}`)).json()).toEqual({ ...model, id })

  expect((await request.put(`/api/v1/models/${id}`, { data: { ...model, name: 'Renamed' } })).status()).toBe(204)
  expect(await (await request.get(`/api/v1/models/${id}`)).json()).toMatchObject({ name: 'Renamed' })

  expect((await request.delete(`/api/v1/models/${id}`)).status()).toBe(204)
  expect((await request.get(`/api/v1/models/${id}`)).status()).toBe(404)
})

test("keeps a Database table's rows, starting with its sample rows, and deletes them with the model", async ({ request }) => {
  const table = {
    feature: 'DatabaseTableFeature',
    id: '2',
    inputs: { name: 'Requests', fields: ['title: text, required', 'status: choice open | done, default open'], sample_rows: '[{"title": "Sample"}]' },
  }
  const { id } = (await (await request.post('/api/v1/models', { data: { ...model, features: [...model.features, table] } })).json()) as { id: string }
  const rows = `/api/v1/models/${id}/tables/2/rows`
  try {
    const created = await request.post(rows, { data: { title: 'Added' } })
    expect(created.status()).toBe(201)
    const row = (await created.json()) as { id: string }
    expect((await request.patch(`${rows}/${row.id}`, { data: { status: 'done' } })).status()).toBe(200)
    expect(await (await request.get(rows)).json()).toEqual([
      expect.objectContaining({ title: 'Sample', status: 'open' }),
      expect.objectContaining({ id: row.id, title: 'Added', status: 'done' }),
    ])
    expect((await request.post(rows, { form: { title: 'From a form' } })).status()).toBe(415)
  } finally {
    await request.delete(`/api/v1/models/${id}`)
  }
  expect((await request.get(rows)).status()).toBe(404)
})

test('starts a model from a name, serves its OpenAPI spec, and resets the home page, which the list leaves out', async ({ request }) => {
  const created = await request.post('/api/v1/models', { data: { name: 'Named only' } })
  expect(created.status()).toBe(201)
  const { id } = (await created.json()) as { id: string }
  try {
    expect(await (await request.get(`/api/v1/models/${id}`)).json()).toMatchObject({ name: 'Named only', features: [{ feature: 'PageFeature' }] })
    const spec = (await (await request.get('/api/v1/openapi.json')).json()) as { openapi: string; servers: { url: string }[] }
    expect(spec).toMatchObject({ openapi: '3.0.3', servers: [{ url: '/api/v1' }] })

    // This changes the home model in the shared e2e database (and deletes it afterwards), which other real-D1 tests
    // (sync.spec.ts) run beside: none of them may depend on what / shows.
    expect((await request.post('/api/v1/home/reset', { data: {} })).status()).toBe(204)
    expect((await request.post('/api/v1/home/reset', { form: { a: '1' } })).status()).toBe(415)
    expect(await (await request.get('/api/v1/models/home')).json()).toMatchObject({ id: 'home', name: 'Home page' })
    const listed = (await (await request.get('/api/v1/models')).json()) as { id: string }[]
    expect(listed.map((m) => m.id)).toContain(id)
    expect(listed.map((m) => m.id)).not.toContain('home')
  } finally {
    await request.delete(`/api/v1/models/${id}`)
    await request.delete('/api/v1/models/home')
  }
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
  // As a browser revalidates after Cloudflare's edge weakened the ETag.
  expect((await request.get(path, { headers: { 'If-None-Match': 'W/"2"' } })).status()).toBe(304)
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

test('serves pages and assets with a Content Security Policy, and keeps _headers itself private', async ({ request }) => {
  const index = await request.get('/')
  const html = await index.text()
  const script = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1]
  const stylesheet = /href="(\/assets\/[^"]+\.css)"/.exec(html)?.[1]
  const font = /url\((\/assets\/[^)]+\.woff2)\)/.exec(await (await request.get(stylesheet!)).text())?.[1]
  expect([script, stylesheet, font]).not.toContain(undefined)
  for (const path of ['/', '/preview.html', '/models/some-id', script!, stylesheet!, font!]) {
    const headers = (await request.get(path)).headers()
    expect(headers['content-security-policy'], path).toContain("script-src 'self';")
    expect(headers['content-security-policy'], path).toContain("frame-ancestors 'none'")
    expect(headers['x-content-type-options'], path).toBe('nosniff')
    expect(headers['referrer-policy'], path).toBe('no-referrer')
    expect(headers['cross-origin-opener-policy'], path).toBe('same-origin')
    expect(headers['permissions-policy'], path).toBe('camera=(), microphone=(), geolocation=()')
  }
  expect(await (await request.get('/_headers')).text()).not.toContain('Content-Security-Policy')

  const api = (await request.get('/api/v1/models')).headers()
  expect(api['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'")
})

test("publishes a model as an app on its own host, which reaches nothing of the builder's", async ({ request }) => {
  const table = {
    feature: 'DatabaseTableFeature',
    id: '2',
    inputs: { name: 'Requests', fields: ['title: text, required'], sample_rows: '[{"title": "Sample"}]' },
  }
  const created = await request.post('/api/v1/models', { data: { ...model, features: [...model.features, table] } })
  const { id } = (await created.json()) as { id: string }
  // Apps answer at <slug>.localhost in development; the request names that host, as a browser would.
  const host = { Host: 'e2e-requests.localhost:4173' }
  try {
    const published = await request.post(`/api/v1/models/${id}/publish`, {
      data: { slug: 'e2e-requests' },
      headers: { 'If-Match': created.headers()['etag']! },
    })
    expect(published.status()).toBe(200)
    expect(await published.json()).toMatchObject({ url: 'http://e2e-requests.localhost:4173/', version: 1 })

    const page = await request.get('/', { headers: host })
    expect(page.status()).toBe(200)
    const html = await page.text()
    expect(html).toContain('<main id="app">')
    const script = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1]
    for (const path of ['/', '/models/7', script!]) {
      const headers = (await request.get(path, { headers: host })).headers()
      expect(headers['content-security-policy'], path).toContain("script-src 'self';")
      expect(headers['x-content-type-options'], path).toBe('nosniff')
    }
    expect(await (await request.get('/api/v1/app', { headers: host })).json()).toMatchObject({ id, name: 'API round trip' })
    expect(await (await request.get('/api/v1/app/tables/2/rows', { headers: host })).json()).toEqual([expect.objectContaining({ title: 'Sample' })])
    expect((await request.get('/api/v1/models', { headers: host })).status()).toBe(404)
    expect((await request.get('/', { headers: { Host: 'a.b.localhost:4173' } })).status()).toBe(404)
  } finally {
    await request.delete(`/api/v1/models/${id}`)
  }
  expect((await request.get('/api/v1/app', { headers: host })).status()).toBe(404)
})

test("shows a published app's page on its host, and says when nothing is published there", async ({ page, request }) => {
  const header = { feature: 'HeaderFeature', id: '2', inputs: { text: 'Fresh bread daily' }, placement: { parent: '1', slot: 'content' } }
  const created = await request.post('/api/v1/models', { data: { ...model, name: 'Corner bakery', features: [...model.features, header] } })
  const { id } = (await created.json()) as { id: string }
  const violations: string[] = []
  page.on('console', (message) => {
    if (isCspViolation(message)) violations.push(message.text())
  })
  try {
    await request.post(`/api/v1/models/${id}/publish`, { data: { slug: 'e2e-bakery' }, headers: { 'If-Match': created.headers()['etag']! } })
    await page.goto('http://e2e-bakery.localhost:4173/menu')
    // The published version, rendered (the real Worker and D1 behind the app's API).
    await expect(page.locator('.fd-root').getByRole('heading', { name: 'Fresh bread daily' })).toBeVisible()
    await expect(page).toHaveTitle('Corner bakery')
    await page.goto('http://e2e-nothing.localhost:4173/')
    await expect(page.getByText('Nothing is published at this address.')).toBeVisible()
    expect(violations).toEqual([])
  } finally {
    await request.delete(`/api/v1/models/${id}`)
  }
})

test('refuses scripts that are not the app’s own, and reports it as the e2e guard expects', async ({ page }) => {
  const reported = page.waitForEvent('console', isCspViolation)
  await page.goto('/preview.html')
  const ran = await page.evaluate(() => {
    const script = document.createElement('script')
    script.textContent = 'window.injected = true'
    document.head.append(script)
    return (window as { injected?: boolean }).injected === true
  })
  expect(ran).toBe(false)
  // isolateNetwork fails tests on these messages, so they must keep arriving in this form.
  expect((await reported).text()).toContain("script-src 'self'")
})

test("proxies only a model's Server addresses", async ({ request }) => {
  const created = await request.post('/api/v1/models', {
    data: {
      ...model,
      features: [
        ...model.features,
        { feature: 'DataResourceFeature', id: '2', inputs: { name: 'Rows', resource: 'https://rows.example.test/rows', fetch_through: 'server' } },
      ],
    },
  })
  const { id } = (await created.json()) as { id: string }
  const proxy = (data: Record<string, unknown>) => request.post('/api/v1/proxy', { data: { model: id, method: 'GET', ...data } })

  const refused = await proxy({ url: 'https://elsewhere.example.test/rows' })
  expect(refused.status()).toBe(403)
  expect(refused.headers()['x-proxy-error']).toBe('true')
  expect(refused.headers()['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'")
  expect((await proxy({ url: 'https://localhost/rows' })).status()).toBe(403)
  expect((await proxy({ model: 'missing', url: 'https://rows.example.test/rows' })).status()).toBe(404)
  expect((await request.get('/api/v1/proxy')).status()).toBe(405)

  await request.delete(`/api/v1/models/${id}`)
})
