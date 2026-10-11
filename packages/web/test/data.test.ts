import { generate, MAX_SAMPLE_ROWS, type AppModel, type DataSource } from '@feature-domain/engine'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { DataStore, forgetSampleRows } from '../src/renderer/data'
import DocumentView from '../src/renderer/DocumentView.vue'
import { FETCH_JSON, type FetchJson } from '../src/renderer/rows'
import { inst, MemoryStorage, model, page } from './helpers'

const address = (endPoint: string, path?: string): DataSource => ({ feature: 'r', resource: 'Repos', operation: 'GET', endPoint, ...(path ? { path } : {}) })
const sample = (rows: Record<string, unknown>[], feature = 's'): DataSource => ({ feature, resource: 'People', operation: 'GET rows', endPoint: '', rows })

/** Reads sources from a store inside an effect scope, as components do. */
function reader(store: DataStore, source: DataSource) {
  return effectScope().run(() => store.rows(ref(source)))!
}

/** A reader whose source can change, and whose scope can be stopped (as when its table goes away). */
function liveReader(store: DataStore, source: DataSource) {
  const scope = effectScope()
  const s = ref(source)
  const state = scope.run(() => store.rows(s))!
  return { state, source: s, stop: () => scope.stop() }
}

describe('DataStore', () => {
  it('fetches an address once for every reader, each taking its own path, and reloads them all together', async () => {
    let calls = 0
    const fetchJson = vi.fn<FetchJson>(async () => ({ items: [{ n: ++calls }], meta: [{ m: calls }] }))
    const store = new DataStore(fetchJson)
    const items = reader(store, address('https://x.test/a', 'items'))
    const meta = reader(store, address('https://x.test/a', 'meta'))
    expect(items.value.status).toBe('loading')
    await flushPromises()
    expect(fetchJson).toHaveBeenCalledTimes(1)
    expect(items.value).toEqual({ status: 'loaded', rows: [{ n: 1 }] })
    expect(meta.value).toEqual({ status: 'loaded', rows: [{ m: 1 }] })

    await store.reload(address('https://x.test/a'))
    expect(fetchJson).toHaveBeenCalledTimes(2)
    expect(items.value).toEqual({ status: 'loaded', rows: [{ n: 2 }] })
    expect(meta.value).toEqual({ status: 'loaded', rows: [{ m: 2 }] })
  })

  it('reports a failed fetch, or a path that is not a list, as an error for that reader', async () => {
    const store = new DataStore(async (url) => {
      if (url.endsWith('bad')) throw new Error('500 Server Error')
      return { items: 'nope' }
    })
    const failed = reader(store, address('https://x.test/bad'))
    const notList = reader(store, address('https://x.test/ok', 'items'))
    await flushPromises()
    expect(failed.value).toEqual({ status: 'error', message: '500 Server Error' })
    expect(notList.value).toEqual({ status: 'error', message: '"items" in the response is not a list' })
  })

  it('discards a response that arrives after a newer request', async () => {
    const pending: ((value: unknown) => void)[] = []
    const store = new DataStore(() => new Promise((resolve) => pending.push(resolve)))
    const rows = reader(store, address('https://x.test/a'))
    void store.reload(address('https://x.test/a'))
    pending[1]!([{ v: 'new' }])
    pending[0]!([{ v: 'old' }])
    await flushPromises()
    expect(rows.value).toEqual({ status: 'loaded', rows: [{ v: 'new' }] })
  })

  it('tries a failed address again for a new reader, or when a reader comes back to it', async () => {
    let fail = true
    const fetchJson = vi.fn<FetchJson>(async () => {
      if (fail) throw new Error('offline')
      return [{ ok: 1 }]
    })
    const store = new DataStore(fetchJson)
    const first = liveReader(store, address('https://x.test/a'))
    await flushPromises()
    expect(first.state.value).toEqual({ status: 'error', message: 'offline' })
    fail = false
    const second = reader(store, address('https://x.test/a'))
    await flushPromises()
    expect(fetchJson).toHaveBeenCalledTimes(2)
    expect(second.value).toEqual({ status: 'loaded', rows: [{ ok: 1 }] })
    expect(first.state.value).toEqual({ status: 'loaded', rows: [{ ok: 1 }] })
  })

  it('drops an address no one reads any more, so typing a URL keeps nothing it passed through', async () => {
    const fetchJson = vi.fn<FetchJson>(async (url) => [{ url }])
    const store = new DataStore(fetchJson)
    const live = liveReader(store, address('https://x.test/a'))
    for (const url of ['https://x.test/ab', 'https://x.test/abc']) {
      live.source.value = address(url)
      await flushPromises()
    }
    expect(live.state.value).toEqual({ status: 'loaded', rows: [{ url: 'https://x.test/abc' }] })
    // Back to an address it left: fetched again, since nothing kept it.
    live.source.value = address('https://x.test/a')
    await flushPromises()
    expect(fetchJson).toHaveBeenCalledTimes(4)
    expect((store as unknown as { fetched: Map<string, unknown> }).fetched.size).toBe(1)
    live.stop()
    expect((store as unknown as { fetched: Map<string, unknown> }).fetched.size).toBe(0)
  })

  it('serves sample rows with any added since, fetching nothing, and keeps added rows per model', async () => {
    const fetchJson = vi.fn<FetchJson>()
    const storage = new MemoryStorage()
    const store = new DataStore(fetchJson, 'm1', storage)
    const people = reader(store, sample([{ name: 'Ada' }]))
    expect(people.value).toEqual({ status: 'loaded', rows: [{ name: 'Ada' }] })
    store.addSampleRow('s', { name: 'Grace' })
    expect(people.value).toEqual({ status: 'loaded', rows: [{ name: 'Ada' }, { name: 'Grace' }] })
    expect(store.addedRows('s')).toBe(1)
    await store.reload(sample([]))
    expect(fetchJson).not.toHaveBeenCalled()

    // The same model in a new page load keeps the added row; another model doesn't see it.
    expect(reader(new DataStore(fetchJson, 'm1', storage), sample([{ name: 'Ada' }])).value).toMatchObject({ rows: [{ name: 'Ada' }, { name: 'Grace' }] })
    expect(reader(new DataStore(fetchJson, 'm2', storage), sample([{ name: 'Ada' }])).value).toMatchObject({ rows: [{ name: 'Ada' }] })

    store.clearAddedRows('s')
    expect(people.value).toMatchObject({ rows: [{ name: 'Ada' }] })
    expect(storage.length).toBe(0)

    // Added rows are capped like the model's own, and forgotten with the model.
    for (let i = 0; i < MAX_SAMPLE_ROWS; i++) expect(store.addSampleRow('s', { i })).toBe(true)
    expect(store.addSampleRow('s', { i: 'one too many' })).toBe(false)
    expect(store.addedRows('s')).toBe(MAX_SAMPLE_ROWS)
    forgetSampleRows('m1', storage)
    expect(storage.length).toBe(0)
  })

  it('ignores stored added rows it cannot read', () => {
    const storage = new MemoryStorage()
    for (const junk of ['not json', '[1,2]', '{"s": "x"}', '{"__proto__": [{"x": 1}]}', '{"s": [1, null, {"name": "ok"}]}']) {
      storage.setItem('feature-domain:sample-rows:m1', junk)
      expect(() => reader(new DataStore(async () => [], 'm1', storage), sample([]))).not.toThrow()
    }
    expect(reader(new DataStore(async () => [], 'm1', storage), sample([])).value).toEqual({ status: 'loaded', rows: [{ name: 'ok' }] })
  })
})

describe('Tables on shared data', () => {
  const render = (m: AppModel, fetchJson: FetchJson) =>
    mount(DocumentView, { props: { root: generate(m).root }, global: { provide: { [FETCH_JSON as symbol]: fetchJson } } })

  it('shows a new data resource\'s sample rows at once, with a column per key, and fetches nothing', async () => {
    const fetchJson = vi.fn<FetchJson>()
    const w = render(model(inst('DataResourceFeature', 'r', { source: 'sample', sample_rows: '[{"name": "Ada", "city": "London"}]' }, null), page(), inst('TableFeature', 't', { data_resource: 'r' })), fetchJson)
    await flushPromises()
    expect(w.findAll('th').map((th) => th.text())).toEqual(['Name', 'City'])
    expect(w.findAll('tbody td').map((td) => td.text())).toEqual(['Ada', 'London'])
    expect(fetchJson).not.toHaveBeenCalled()
  })

  it('fetches once for two tables on the same address, and Try again reloads both', async () => {
    let fail = true
    const fetchJson = vi.fn<FetchJson>(async () => {
      if (fail) throw new Error('offline')
      return [{ name: 'repo' }]
    })
    const repos = inst('DataResourceFeature', 'r', { resource: 'https://api.github.com/users/x/repos' }, null)
    const table = (id: string) => inst('TableFeature', id, { data_resource: 'r', fields: ['name'] })
    const w = render(model(repos, page(), table('a'), table('b')), fetchJson)
    await flushPromises()
    expect(fetchJson).toHaveBeenCalledTimes(1)
    expect(w.findAll('.fd-table-problem')).toHaveLength(2)
    fail = false
    await w.get('[data-feature-id="a"] .fd-table-retry').trigger('click')
    await flushPromises()
    expect(fetchJson).toHaveBeenCalledTimes(2)
    expect(w.findAll('tbody td').map((td) => td.text())).toEqual(['repo', 'repo'])
  })
})
