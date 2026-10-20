import { generate, MemoryModelStore } from '@feature-domain/engine'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DocumentView from '../src/renderer/DocumentView.vue'
import { browserFetchJson, browserSendRequest } from '../src/renderer/rows'
import { OPEN_ADDRESS } from '../src/renderer/urls'
import { ApiModelStore, HOME_ID } from '../src/stores/apiModelStore'
import { workerApp } from './workerApp'

// The models API on this site: the one same-site address pages read and change data through (the home page).

afterEach(() => vi.unstubAllGlobals())

const stub = (answer: () => Response) => {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init })
      return answer()
    }),
  )
  return calls
}

describe('requests to the models API', () => {
  it('are made by the browser, never through the proxy, and never follow a redirect', async () => {
    const calls = stub(() => Response.json([{ id: 'a' }]))
    expect(await browserFetchJson('/api/v1/models', { model: 'm1' })).toEqual([{ id: 'a' }])
    expect(await browserSendRequest({ method: 'POST', url: '/api/v1/models', body: { name: 'Shop' } }, { model: 'm1' })).toEqual([{ id: 'a' }])
    await browserSendRequest({ method: 'DELETE', url: '/api/v1/models/a' })
    expect(calls.map((c) => [c.url, c.init.method ?? 'GET'])).toEqual([
      ['/api/v1/models', 'GET'],
      ['/api/v1/models', 'POST'],
      ['/api/v1/models/a', 'DELETE'],
    ])
    for (const { init } of calls) expect(init.redirect).toBe('manual')
    expect(calls[1]!.init.headers).toEqual({ Accept: 'application/json', 'Content-Type': 'application/json' })
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ name: 'Shop' })
  })

  it('refuses every other path on this site', async () => {
    const calls = stub(() => Response.json({}))
    for (const url of ['/api/v1/proxy', '/api/v1/models/a/b', '/api/v1/models/..', '/api/v1/models/%2e%2e', '/models/a']) {
      await expect(browserFetchJson(url), url).rejects.toThrow(`Only http(s) URLs can be loaded, not "${url}"`)
      await expect(browserSendRequest({ method: 'DELETE', url }), url).rejects.toThrow(`Only http(s) URLs can be sent to, not "${url}"`)
    }
    expect(calls).toEqual([])
  })

  it("fetches and sends to every http(s) address without this site's cookies, so a full address on this site can't use the session", async () => {
    const calls = stub(() => Response.json({}))
    const own = 'https://app.feature-domain.workers.dev/api/v1/home/reset'
    await browserFetchJson(own)
    await browserSendRequest({ method: 'POST', url: own, body: {} })
    await browserSendRequest({ method: 'DELETE', url: 'https://api.example.com/rows/1' })
    expect(calls.map((c) => c.init.credentials)).toEqual(['omit', 'omit', 'omit'])
  })

  it("reads Access's HTML sign-in page as an expired sign-in, however its Content-Type is written", async () => {
    stub(() => new Response('<html>', { status: 200, headers: { 'Content-Type': 'Text/HTML; charset=utf-8' } }))
    await expect(browserFetchJson('/api/v1/models')).rejects.toThrow('Your sign-in has expired; reload the page to sign in again')
  })

  it('says what the API refused, and that the sign-in expired when Access answers instead', async () => {
    stub(() => Response.json({ error: 'The model is not valid', problems: ['Give the model a name'] }, { status: 400 }))
    await expect(browserSendRequest({ method: 'POST', url: '/api/v1/models', body: { name: '' } })).rejects.toThrow(
      'The model is not valid: Give the model a name',
    )
    stub(() => new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
    await expect(browserFetchJson('/api/v1/models')).rejects.toThrow('Your sign-in has expired; reload the page to sign in again')
    stub(() => Object.defineProperty(new Response(null, { status: 200 }), 'type', { value: 'opaqueredirect' }))
    await expect(browserFetchJson('/api/v1/models')).rejects.toThrow('Your sign-in has expired; reload the page to sign in again')
    stub(() => new Response('', { status: 502, statusText: 'Bad Gateway' }))
    await expect(browserFetchJson('/api/v1/models')).rejects.toThrow('502 Bad Gateway')
  })
})

describe('the built-in home page', () => {
  /** The Worker's real routes over a store of its own, answering this page's requests, with the home page stored. */
  async function home() {
    const store = new MemoryModelStore(undefined, () => Date.UTC(2026, 9, 20, 8, 30))
    const app = await workerApp(store)
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => app.request(url, init, {}))
    const api = new ApiModelStore()
    await api.resetHome()
    const first = await api.create({ version: 2, name: 'Harbor Coffee', features: [] })
    const opened: string[] = []
    const w = mount(DocumentView, {
      props: { root: generate((await api.get(HOME_ID))!.model).root, modelId: HOME_ID },
      global: { provide: { [OPEN_ADDRESS as symbol]: (href: string) => opened.push(href) } },
      attachTo: document.body,
    })
    await flushPromises()
    return { w, api, first, opened }
  }

  it('lists the models (not itself), each linked to its editor, with when it last changed', async () => {
    const { w, first } = await home()
    const link = w.get('table a')
    expect(link.text()).toBe('Harbor Coffee')
    expect(link.attributes('href')).toBe(`/models/${first}`)
    expect(w.get('table').text()).toContain('Oct 20, 2026')
    expect(w.findAll('tbody tr')).toHaveLength(1)
    w.unmount()
  })

  it('creates a model from a name, and opens it in the editor', async () => {
    const { w, api, opened } = await home()
    await w.get('form input').setValue('Shop')
    await w.get('form').trigger('submit')
    await flushPromises()
    const created = (await api.list()).find((m) => m.name === 'Shop')!
    expect(opened).toEqual([`/models/${created.id}`])
    expect((await api.get(created.id))?.model.features).toHaveLength(1)
    w.unmount()
  })

  it('deletes a model from its row', async () => {
    const { w, api } = await home()
    await w.get('tbody tr button').trigger('click')
    await w
      .findAll('tbody button')
      .find((b) => b.text() === 'Delete')!
      .trigger('click')
    await flushPromises()
    expect(await api.list()).toEqual([])
    expect(w.findAll('tbody tr a')).toHaveLength(0)
    w.unmount()
  })
})
