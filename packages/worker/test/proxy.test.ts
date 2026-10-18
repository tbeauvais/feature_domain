import { MemoryModelStore, type AppModel, type FeatureInstance } from '@feature-domain/engine'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { API_HEADERS, createApp } from '../src/app'
import { PROXY_ERROR_HEADER, PROXY_LIMITS } from '../src/proxy'

const resource = (id: string, url: string, fetchThrough = 'server'): FeatureInstance => ({
  feature: 'DataResourceFeature',
  id,
  inputs: { name: id, resource: url, fetch_through: fetchThrough },
})
const modelWith = (...features: FeatureInstance[]): AppModel => ({ version: 2, name: 'Proxy', features })

interface Sent {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  type?: string
}

let store: MemoryModelStore
let id: string
let sent: Sent[]
let answer: (url: string, init: RequestInit) => Response | Promise<Response>

const upstream: typeof fetch = async (input, init = {}) => {
  const headers = Object.fromEntries(new Headers(init.headers).entries())
  const encoded = init.body === undefined || init.body === null ? undefined : new Request('https://x.test', { method: 'POST', body: init.body })
  sent.push({
    url: String(input),
    method: init.method ?? 'GET',
    headers,
    body: encoded ? await encoded.text() : undefined,
    type: encoded?.headers.get('Content-Type') ?? undefined,
  })
  return answer(String(input), init)
}

const app = () => createApp(() => store, upstream)
const proxy = (request: Record<string, unknown>, headers: Record<string, string> = {}) =>
  app().request('https://app.feature-domain.workers.dev/api/v1/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ model: id, method: 'GET', ...request }),
  })

beforeEach(async () => {
  store = new MemoryModelStore()
  id = await store.create(
    modelWith(
      resource('a', 'https://api.example.com/repos'),
      resource('b', 'https://browser.example.com/rows', 'browser'),
      resource('c', 'https://self.example.com/{id}'),
    ),
  )
  sent = []
  answer = () => Response.json([{ name: 'Ada' }])
})

const errorOf = async (response: Response) => {
  expect(response.headers.get(PROXY_ERROR_HEADER)).toBe('true')
  return ((await response.json()) as { error: string }).error
}

describe('/api/v1/proxy', () => {
  it("fetches an address on one of the model's Server origins and passes on the answer", async () => {
    answer = () =>
      new Response('[{"name":"Ada"}]', { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': 'a=b', 'X-Other': '1' } })
    const response = await proxy({ url: 'https://api.example.com/repos?page=2' }, { Cookie: 'CF_Authorization=secret', Authorization: 'Bearer secret' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([{ name: 'Ada' }])
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('Set-Cookie')).toBeNull()
    expect(response.headers.get('X-Other')).toBeNull()
    expect(response.headers.get(PROXY_ERROR_HEADER)).toBeNull()
    for (const [name, value] of Object.entries(API_HEADERS)) expect(response.headers.get(name)).toBe(value)

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ url: 'https://api.example.com/repos?page=2', method: 'GET' })
    // Only its own headers: nothing from the page's request (cookies, Access's token) goes on.
    expect(Object.keys(sent[0]!.headers).sort()).toEqual(['accept', 'user-agent'])
  })

  it('allows any path on the origin, such as one with placeholders filled', async () => {
    expect((await proxy({ url: 'https://self.example.com/42', method: 'DELETE' })).status).toBe(200)
    expect(sent[0]).toMatchObject({ url: 'https://self.example.com/42', method: 'DELETE' })
  })

  it('passes on the site’s errors unmarked', async () => {
    answer = () => new Response('nope', { status: 500, headers: { 'Content-Type': 'text/plain' } })
    const response = await proxy({ url: 'https://api.example.com/repos' })
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('nope')
    expect(response.headers.get(PROXY_ERROR_HEADER)).toBeNull()
  })

  it('sends a body as JSON, form-encoded or multipart form data', async () => {
    answer = () => new Response(null, { status: 204 })
    const body = { name: 'Ada', projects: 3, active: true, note: null }
    expect((await proxy({ url: 'https://api.example.com/repos', method: 'POST', body })).status).toBe(204)
    await proxy({ url: 'https://api.example.com/repos', method: 'PUT', body, requestType: 'form' })
    await proxy({ url: 'https://api.example.com/repos', method: 'POST', body, requestType: 'multipart' })
    expect(sent[0]).toMatchObject({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
    expect(sent[1]).toMatchObject({ method: 'PUT', body: 'name=Ada&projects=3&active=true&note=', type: 'application/x-www-form-urlencoded;charset=UTF-8' })
    expect(sent[2]!.type).toMatch(/^multipart\/form-data; boundary=/)
    expect(sent[2]!.body).toContain('name="projects"\r\n\r\n3')
  })

  it("refuses addresses that aren't the model's Server addresses", async () => {
    for (const url of [
      'https://browser.example.com/rows',
      'https://elsewhere.example.com/repos',
      'http://api.example.com/repos',
      'https://example.com/repos',
    ]) {
      const response = await proxy({ url })
      expect(response.status, url).toBe(403)
      expect(await errorOf(response)).toBe("It isn't one of this model's addresses fetched through the server")
    }
    expect(sent).toEqual([])
  })

  it('never fetches local, numeric or non-standard addresses, or this site', async () => {
    const local = [
      'https://127.0.0.1/x',
      'https://0x7f.1/x',
      'https://[::1]/x',
      'https://localhost/x',
      'https://intranet/x',
      'https://printer.local/x',
      'https://db.internal/x',
      'https://api.example.com:8443/x',
      'https://app.feature-domain.workers.dev/api/v1/models',
    ]
    for (const url of local) expect((await proxy({ url })).status, url).toBe(403)
    expect(await errorOf(await proxy({ url: 'https://127.0.0.1/x' }))).toBe('IP addresses are never fetched')
    expect(await errorOf(await proxy({ url: 'https://printer.local/x' }))).toBe('Local names are never fetched')
    expect(await errorOf(await proxy({ url: 'https://app.feature-domain.workers.dev/x' }))).toBe('This site is never fetched')
    for (const url of ['ftp://api.example.com/x', 'https://user:pass@api.example.com/repos', 'not an address']) {
      expect((await proxy({ url })).status, url).toBe(400)
    }
    expect(sent).toEqual([])
  })

  it('follows redirects on allowed origins, checking each, at most three', async () => {
    let hops = 0
    answer = (url) =>
      url.endsWith('/final')
        ? Response.json({ ok: true })
        : new Response(null, { status: 302, headers: { Location: `/hop${++hops}${hops >= 2 ? '/final' : ''}` } })
    expect(await (await proxy({ url: 'https://api.example.com/repos' })).json()).toEqual({ ok: true })
    expect(sent.map((s) => s.url)).toEqual(['https://api.example.com/repos', 'https://api.example.com/hop1', 'https://api.example.com/hop2/final'])

    sent = []
    answer = () => new Response(null, { status: 301, headers: { Location: 'https://api.example.com/again' } })
    const tooMany = await proxy({ url: 'https://api.example.com/repos' })
    expect(tooMany.status).toBe(502)
    expect(await errorOf(tooMany)).toContain('more than 3 times')
    expect(sent).toHaveLength(4)

    for (const location of ['https://evil.example.com/', 'http://127.0.0.1/', 'https://localhost/']) {
      answer = () => new Response(null, { status: 307, headers: { Location: location } })
      const refused = await proxy({ url: 'https://api.example.com/repos' })
      expect(refused.status, location).toBe(502)
      expect(await errorOf(refused)).toContain("redirected somewhere the proxy doesn't fetch")
    }
  })

  it('follows a 303, or a 302 after a POST, with a GET without the body', async () => {
    for (const status of [303, 302]) {
      sent = []
      answer = (url) => (url.endsWith('/done') ? Response.json({}) : new Response(null, { status, headers: { Location: '/done' } }))
      await proxy({ url: 'https://api.example.com/repos', method: 'POST', body: { name: 'Ada' } })
      expect(sent[1]).toMatchObject({ method: 'GET', body: undefined })
      expect(sent[1]!.headers['content-type']).toBeUndefined()
    }
    sent = []
    answer = (url) => (url.endsWith('/done') ? Response.json({}) : new Response(null, { status: 307, headers: { Location: '/done' } }))
    await proxy({ url: 'https://api.example.com/repos', method: 'POST', body: { name: 'Ada' } })
    expect(sent[1]).toMatchObject({ method: 'POST', body: '{"name":"Ada"}' })
  })

  it('refuses answers over the size limit, whether announced or streamed', async () => {
    answer = () => new Response('[]', { headers: { 'Content-Length': String(PROXY_LIMITS.responseBytes + 1) } })
    expect(await errorOf(await proxy({ url: 'https://api.example.com/repos' }))).toContain('more than 5 MB')
    const chunk = new Uint8Array(1_000_000)
    answer = () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(chunk)
          },
        }),
      )
    const streamed = await proxy({ url: 'https://api.example.com/repos' })
    expect(streamed.status).toBe(502)
    expect(await errorOf(streamed)).toContain('more than 5 MB')
  })

  describe('when the site is slow or unreachable', () => {
    const timeout = PROXY_LIMITS.timeoutMs
    afterEach(() => {
      PROXY_LIMITS.timeoutMs = timeout
    })

    it('gives up after the time limit', async () => {
      PROXY_LIMITS.timeoutMs = 20
      answer = (_, init) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason as Error)))
      const response = await proxy({ url: 'https://api.example.com/repos' })
      expect(response.status).toBe(504)
      expect(await errorOf(response)).toBe("The site didn't answer within 0.02 s")
    })

    it('says when it could not reach the site', async () => {
      answer = () => Promise.reject(new TypeError('fetch failed'))
      const response = await proxy({ url: 'https://api.example.com/repos' })
      expect(response.status).toBe(502)
      expect(await errorOf(response)).toBe("Couldn't reach the site")
    })
  })

  it('refuses requests it cannot read, for models that do not exist', async () => {
    const cases: [Record<string, unknown>, number, string][] = [
      [{ model: 'missing', url: 'https://api.example.com/repos' }, 404, 'No model with this id'],
      [{ method: 'PATCH', url: 'https://api.example.com/repos' }, 400, 'method must be one of'],
      [{ url: 'https://api.example.com/repos', body: { a: 1 } }, 400, 'A GET request has no body'],
      [{ method: 'POST', url: 'https://api.example.com/repos', body: { a: { nested: true } } }, 400, 'body values must be'],
      [{ method: 'POST', url: 'https://api.example.com/repos', body: [1] }, 400, 'body must be an object'],
      [{ url: 'https://api.example.com/repos', requestType: 'xml' }, 400, 'requestType must be'],
      [{ url: 42 }, 400, 'url must be an address'],
    ]
    for (const [request, status, message] of cases) {
      const response = await proxy(request)
      expect(response.status, message).toBe(status)
      expect(await errorOf(response)).toContain(message)
    }
    const url = 'https://app.feature-domain.workers.dev/api/v1/proxy'
    const notJson = await app().request(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })
    expect(await errorOf(notJson)).toContain('application/json')
    const broken = await app().request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })
    expect(await errorOf(broken)).toContain('not valid JSON')
    const large = await proxy({ method: 'POST', url: 'https://api.example.com/repos', body: { text: 'x'.repeat(PROXY_LIMITS.requestBytes) } })
    expect(large.status).toBe(413)
    expect(await errorOf(large)).toContain('limited to')
    const get = await app().request(url)
    expect(get.status).toBe(405)
    expect(get.headers.get('Allow')).toBe('POST')
    expect(sent).toEqual([])
  })

  it('follows the stored model: a save that changes Fetch through changes what is allowed', async () => {
    expect((await proxy({ url: 'https://browser.example.com/rows' })).status).toBe(403)
    const { model } = (await store.get(id))!
    await store.update(id, { ...model, features: model.features.map((f) => (f.id === 'b' ? resource('b', 'https://browser.example.com/rows') : f)) })
    expect((await proxy({ url: 'https://browser.example.com/rows' })).status).toBe(200)
    await store.update(id, modelWith())
    expect((await proxy({ url: 'https://api.example.com/repos' })).status).toBe(403)
  })
})
