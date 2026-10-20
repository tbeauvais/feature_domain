import { MemoryModelStore, ModelConflictError, ModelNotFoundError } from '@feature-domain/engine'
import { describe, expect, it, vi } from 'vitest'
import { describeModelStore } from '../../engine/test/store-contract'
import { ApiError, ApiModelStore, HOME_ID, KEEPALIVE_MAX_BYTES, REQUEST_TIMEOUT_MS, revisionOf, SignedOutError } from '../src/stores/apiModelStore'
import { model, page } from './helpers'
import { workerApp } from './workerApp'

/** The Worker's own routes, in this process, over a store of their own. */
async function worker(store = new MemoryModelStore()) {
  const app = await workerApp(store)
  // The test environment's Request refuses keepalive, which only matters to browsers; the calls still record it.
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => app.request(String(input), { ...init, keepalive: undefined }, {} as never))
  return { fetch, store, api: new ApiModelStore(fetch as unknown as typeof globalThis.fetch) }
}

describeModelStore('ApiModelStore', async () => (await worker()).api)

const answer = (body: BodyInit | null, init: ResponseInit) => vi.fn(async () => new Response(body, init)) as unknown as typeof globalThis.fetch

describe('ApiModelStore', () => {
  it('sends the revision a save was made from, and reads the new one', async () => {
    const { api, fetch } = await worker()
    const id = await api.create(model(page()))
    expect(await api.update(id, { ...model(page()), name: 'B' }, 1)).toBe(2)
    const [, init] = fetch.mock.calls.at(-1)!
    expect(new Headers(init?.headers).get('If-Match')).toBe('"1"')
    await expect(api.update(id, model(page()), 1)).rejects.toEqual(new ModelConflictError(id, 2))
  })

  it("reads weak ETags, which Cloudflare's edge makes of the API's when it compresses a response", () => {
    expect(revisionOf('"3"')).toBe(3)
    expect(revisionOf('W/"12"')).toBe(12)
    for (const tag of [null, '', '3', '"0"', '"x"', 'W/3', '"1234567890123456"']) expect(revisionOf(tag), String(tag)).toBeUndefined()
  })

  it('sends small saves with keepalive, so one made as the page closes still arrives', async () => {
    const { api, fetch } = await worker()
    const id = await api.create(model(page()))
    await api.update(id, model(page()))
    expect(fetch.mock.calls.at(-1)![1]?.keepalive).toBe(true)
    const big = { ...model(page()), name: 'x'.repeat(KEEPALIVE_MAX_BYTES) }
    await api.update(id, big)
    expect(fetch.mock.calls.at(-1)![1]?.keepalive).toBe(false)
  })

  it('never follows redirects: an expired Access session is a SignedOutError', async () => {
    const redirected = vi.fn(async (_: unknown, init?: RequestInit) => {
      expect(init?.redirect).toBe('manual')
      return Object.defineProperty(new Response(null, { status: 200 }), 'type', { value: 'opaqueredirect' })
    }) as unknown as typeof globalThis.fetch
    await expect(new ApiModelStore(redirected).list()).rejects.toBeInstanceOf(SignedOutError)
    await expect(new ApiModelStore(answer(null, { status: 302, headers: { Location: 'https://x.cloudflareaccess.com' } })).get('a')).rejects.toBeInstanceOf(
      SignedOutError,
    )
    // A sign-in page served in place of the API.
    await expect(new ApiModelStore(answer('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } })).list()).rejects.toBeInstanceOf(SignedOutError)
  })

  it("reports the API's own error message, or the status when there is none", async () => {
    const { api } = await worker()
    await expect(api.create({ version: 1 } as never)).rejects.toMatchObject({ name: 'ApiError', status: 400, message: 'The model is not valid' })
    await expect(new ApiModelStore(answer('oops', { status: 502 })).list()).rejects.toEqual(new ApiError(502, 'the server answered 502'))
    await expect(new ApiModelStore(answer('{}', { status: 500, headers: { 'Content-Type': 'application/json' } })).delete('a')).rejects.toEqual(
      new ApiError(500, 'the server answered 500'),
    )
  })

  it('refuses answers that are not what the API sends', async () => {
    const json = (body: unknown, headers: Record<string, string> = {}) =>
      new ApiModelStore(answer(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } }))
    const odd = { name: 'ApiError', message: 'the server sent an answer the editor does not understand' }
    await expect(json([{ id: 1, name: 'x', updated_at: '2026-10-20T08:00:00.000Z' }]).list()).rejects.toMatchObject(odd)
    await expect(json([{ id: '1', name: 'x' }]).list()).rejects.toMatchObject(odd)
    await expect(json({ not: 'a list' }).list()).rejects.toMatchObject(odd)
    await expect(json([1]).get('a')).rejects.toMatchObject(odd)
    // A model without a revision can't be saved safely.
    await expect(json(model(page())).get('a')).rejects.toMatchObject(odd)
    await expect(json({ id: 3 }).create(model(page()))).rejects.toMatchObject(odd)
    await expect(new ApiModelStore(answer('{', { status: 200, headers: { 'Content-Type': 'application/json' } })).list()).rejects.toMatchObject(odd)
    await expect(new ApiModelStore(answer(null, { status: 204 })).update('a', model(page()))).rejects.toMatchObject(odd)
    await expect(new ApiModelStore(answer(null, { status: 412 })).update('a', model(page()), 1)).rejects.toMatchObject(odd)
  })

  it('reads a model with a weak ETag', async () => {
    const api = new ApiModelStore(answer(JSON.stringify(model(page())), { status: 200, headers: { 'Content-Type': 'application/json', ETag: 'W/"4"' } }))
    expect(await api.get('a')).toEqual({ model: model(page()), revision: 4 })
  })

  it('treats a missing model as missing, and saving one as ModelNotFoundError', async () => {
    const { api } = await worker()
    expect(await api.get('nope')).toBeNull()
    await expect(api.update('nope', model(page()), 1)).rejects.toBeInstanceOf(ModelNotFoundError)
  })

  it('gives up on a request that takes too long, so a hung save becomes a failed one', async () => {
    let signal: AbortSignal | undefined
    const hanging = vi.fn((_: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>((_, reject) => signal!.addEventListener('abort', () => reject(signal!.reason)))
    }) as unknown as typeof globalThis.fetch
    vi.useFakeTimers()
    try {
      const saving = new ApiModelStore(hanging).update('a', model(page()), 1)
      const settled = expect(saving).rejects.toEqual(new ApiError(0, 'the server did not answer in time'))
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)
      await settled
    } finally {
      vi.useRealTimers()
    }
  })

  it('escapes ids in paths', async () => {
    const { api, fetch } = await worker()
    await api.get('a/b?c')
    expect(fetch.mock.calls[0]![0]).toBe('/api/v1/models/a%2Fb%3Fc')
  })

  it('lists when each model was last saved', async () => {
    const { api, store } = await worker(new MemoryModelStore(undefined, () => Date.UTC(2026, 9, 20, 8, 30)))
    const id = await store.create(model(page()))
    expect(await api.list()).toEqual([{ id, name: 'test', updatedAt: '2026-10-20T08:30:00.000Z' }])
  })

  it("puts the built-in home page back under the Worker's home id, which the list leaves out", async () => {
    const { api, store } = await worker()
    await api.resetHome()
    expect((await api.get(HOME_ID))?.model.name).toBe('Home page')
    expect(await api.list()).toEqual([])
    expect((await store.list()).map((m) => m.id)).toEqual([HOME_ID])
  })
})
