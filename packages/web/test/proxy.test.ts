import { generate, type DataAction, type DataSource } from '@feature-domain/engine'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, effectScope, h, provide, ref } from 'vue'
import ApiSpecField from '../src/editor/ApiSpecField.vue'
import { DataStore, PROXY_READY } from '../src/renderer/data'
import DocumentView from '../src/renderer/DocumentView.vue'
import { browserFetchJson, browserSendRequest, FETCH_JSON, PROXY_PATH, SEND_REQUEST, type FetchJson, type SendRequest } from '../src/renderer/rows'
import { useDocumentStore } from '../src/stores/document'
import { inst, model, page } from './helpers'

const source = (proxy: boolean): DataSource => ({
  feature: 'r',
  resource: 'Repos',
  operation: 'GET',
  endPoint: 'https://api.test/repos',
  ...(proxy ? { proxy: true } : {}),
})
const action = (proxy: boolean): DataAction => ({
  feature: 'r',
  resource: 'Repos',
  operation: 'POST',
  method: 'POST',
  endPoint: 'https://api.test/repos',
  ...(proxy ? { proxy: true } : {}),
})

describe('requests through the proxy', () => {
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

  it("posts the request and the model to the Worker's proxy, and reads the site's answer", async () => {
    const calls = stub(() => Response.json([{ name: 'Ada' }]))
    expect(await browserFetchJson('https://api.test/repos', { model: 'm1' })).toEqual([{ name: 'Ada' }])
    expect(await browserSendRequest({ method: 'POST', url: 'https://api.test/repos', body: { name: 'Ada' }, requestType: 'form' }, { model: 'm1' })).toEqual([
      { name: 'Ada' },
    ])
    expect(calls.map((c) => c.url)).toEqual([PROXY_PATH, PROXY_PATH])
    expect(calls[0]!.init).toMatchObject({ method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json' } })
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ model: 'm1', method: 'GET', url: 'https://api.test/repos' })
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({
      model: 'm1',
      method: 'POST',
      url: 'https://api.test/repos',
      body: { name: 'Ada' },
      requestType: 'form',
    })
  })

  it("says why the proxy refused, the site's error status, or that the sign-in expired", async () => {
    stub(() => Response.json({ error: 'It isn’t one of this model’s addresses' }, { status: 403, headers: { 'X-Proxy-Error': 'true' } }))
    await expect(browserFetchJson('https://api.test/repos', { model: 'm1' })).rejects.toThrow('It isn’t one of this model’s addresses')
    stub(() => new Response('nope', { status: 500, statusText: 'Server Error' }))
    await expect(browserSendRequest({ method: 'DELETE', url: 'https://api.test/repos/1' }, { model: 'm1' })).rejects.toThrow('500 Server Error')
    stub(() => new Response('<html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))
    await expect(browserFetchJson('https://api.test/repos', { model: 'm1' })).rejects.toThrow('sign-in has expired')
  })

  it('never sends a non-http(s) address, even through the proxy', async () => {
    const calls = stub(() => Response.json([]))
    await expect(browserFetchJson('/api/v1/models', { model: 'm1' })).rejects.toThrow('Only http(s) URLs')
    await expect(browserSendRequest({ method: 'POST', url: 'javascript:x' }, { model: 'm1' })).rejects.toThrow('Only http(s) URLs')
    expect(calls).toEqual([])
  })

  it('suggests Fetch through Server when the browser could not read or send', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    await expect(browserFetchJson('https://api.test/repos')).rejects.toThrow("set the data resource's Fetch through to Server")
    await expect(browserSendRequest({ method: 'POST', url: 'https://api.test/repos' })).rejects.toThrow("set the data resource's Fetch through to Server")
  })
})

describe('DataStore through the proxy', () => {
  it("fetches a Server source through the proxy for its model, apart from the browser's fetch of the same address", async () => {
    const fetchJson = vi.fn<FetchJson>(async (_, via) => [{ via: via?.model ?? 'browser' }])
    const store = new DataStore(fetchJson, 'm1')
    const scope = effectScope()
    const [server, browser] = scope.run(() => [store.rows(ref(source(true))), store.rows(ref(source(false)))])!
    await flushPromises()
    expect(fetchJson.mock.calls).toEqual([['https://api.test/repos', { model: 'm1' }], ['https://api.test/repos']])
    expect(server.value).toEqual({ status: 'loaded', rows: [{ via: 'm1' }] })
    expect(browser.value).toEqual({ status: 'loaded', rows: [{ via: 'browser' }] })

    await store.reloadResource('r')
    expect(fetchJson).toHaveBeenCalledTimes(4)
    expect(fetchJson.mock.calls[2]).toEqual(['https://api.test/repos', { model: 'm1' }])
    scope.stop()
  })

  it('sends and deletes through the proxy for a Server action', async () => {
    const sendRequest = vi.fn<SendRequest>(async () => undefined)
    const store = new DataStore(async () => [], 'm1', undefined, sendRequest)
    await store.send(action(true), { name: 'Ada' }, [])
    await store.delete({ ...action(true), method: 'DELETE', endPoint: 'https://api.test/repos/{id}' }, { id: 7 })
    await store.send(action(false), { name: 'Bo' }, [])
    expect(sendRequest.mock.calls).toEqual([
      [{ method: 'POST', url: 'https://api.test/repos', body: { name: 'Ada' } }, { model: 'm1' }],
      [{ method: 'DELETE', url: 'https://api.test/repos/7' }, { model: 'm1' }],
      [{ method: 'POST', url: 'https://api.test/repos', body: { name: 'Bo' } }],
    ])
  })

  it('needs a model to fetch through the proxy', async () => {
    const store = new DataStore(async () => [])
    const rows = effectScope().run(() => store.rows(ref(source(true))))!
    await flushPromises()
    expect(rows.value).toEqual({ status: 'error', message: 'Fetching through the server needs a saved model' })
    await expect(store.send(action(true), {}, [])).rejects.toThrow('needs a saved model')
  })
})

describe('the editor and the proxy', () => {
  it('waits for the pending save before fetching through the proxy, but not before a browser fetch', async () => {
    const order: string[] = []
    let save!: () => void
    const ready = vi.fn(() => new Promise<void>((resolve) => (save = () => (order.push('saved'), resolve()))))
    const fetchJson = vi.fn<FetchJson>(async (url, via) => (order.push(`${via ? 'server' : 'browser'} ${url}`), [{ name: 'Ada' }]))
    const m = model(
      inst('DataResourceFeature', 'r', { name: 'Repos', resource: 'https://api.test/repos', fetch_through: 'server' }, null),
      inst('DataResourceFeature', 'b', { name: 'Rows', resource: 'https://api.test/rows' }, null),
      page(),
      inst('TableFeature', 't', { data_resource: 'r' }),
      inst('TableFeature', 'u', { data_resource: 'b' }),
    )
    const Editor = defineComponent(() => {
      provide(PROXY_READY, ready)
      return () => h(DocumentView, { root: generate(m).root, modelId: 'm1', editing: true })
    })
    mount(Editor, { global: { provide: { [FETCH_JSON as symbol]: fetchJson, [SEND_REQUEST as symbol]: vi.fn() } } })
    await flushPromises()
    expect(order).toEqual(['browser https://api.test/rows'])
    save()
    await flushPromises()
    expect(order).toEqual(['browser https://api.test/rows', 'saved', 'server https://api.test/repos'])
    expect(fetchJson).toHaveBeenLastCalledWith('https://api.test/repos', { model: 'm1' })
  })

  it('loads a spec through the proxy when Fetch through is Server, after saving the Spec URL', async () => {
    setActivePinia(createPinia())
    useDocumentStore().modelId = 'm1'
    const order: string[] = []
    const fetchJson = vi.fn<FetchJson>(async (_, via) => (order.push(via ? `server ${via.model}` : 'browser'), { openapi: '3.0.3', paths: {} }))
    const field = mount(ApiSpecField, {
      props: { id: 'spec', labelledby: 'spec-label', value: '', specUrl: 'https://docs.test/openapi.json', viaServer: true },
      global: { provide: { [FETCH_JSON as symbol]: fetchJson, [PROXY_READY as symbol]: async () => order.push('saved') } },
    })
    await field.get('[data-testid="load-spec"]').trigger('click')
    await flushPromises()
    expect(order).toEqual(['saved', 'server m1'])
    expect(field.emitted('change')).toEqual([[JSON.stringify({ openapi: '3.0.3', paths: {} })]])

    await field.setProps({ viaServer: false })
    await field.get('[data-testid="load-spec"]').trigger('click')
    await flushPromises()
    expect(order).toEqual(['saved', 'server m1', 'browser'])
  })
})
