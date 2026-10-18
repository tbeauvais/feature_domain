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
