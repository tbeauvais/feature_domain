import type { DataSource } from '@feature-domain/engine'
import { computed, inject, provide, ref, shallowRef, watch, type ComputedRef, type InjectionKey, type Ref } from 'vue'
import { browserFetchJson, FETCH_JSON, selectRows, type FetchJson, type RowsState } from './rows'

// Runtime data for a generated page: one store per document, shared by every feature reading a data resource.
// - Readers of the same address share one fetch, and `reload` refreshes all of them.
// - A resource serving sample data answers from its rows (from the model) plus rows added since (e.g. by a Form),
//   which are kept per model in the browser.

type Response = { status: 'idle' } | { status: 'loading' } | { status: 'loaded'; response: unknown } | { status: 'error'; message: string }

interface Fetched {
  state: Ref<Response>
  request: number
}

/** Where rows added to sample data are kept, per model. */
export interface SampleRowsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const STORAGE_PREFIX = 'feature-domain:sample-rows:'

export class DataStore {
  private readonly fetched = new Map<string, Fetched>()
  /** Rows added to each sample-data resource (by instance id). */
  private readonly added = shallowRef<Record<string, Record<string, unknown>[]>>({})

  constructor(
    private readonly fetchJson: FetchJson,
    private readonly modelId?: string,
    private readonly storage?: SampleRowsStorage,
  ) {
    const stored = this.storageKey ? this.read(this.storageKey) : undefined
    if (stored) this.added.value = stored
  }

  private get storageKey(): string | undefined {
    return this.modelId && this.storage ? `${STORAGE_PREFIX}${this.modelId}` : undefined
  }

  private read(key: string): Record<string, Record<string, unknown>[]> | undefined {
    try {
      const value: unknown = JSON.parse(this.storage!.getItem(key) ?? 'null')
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
      const out: Record<string, Record<string, unknown>[]> = {}
      for (const [id, rows] of Object.entries(value)) {
        if (Array.isArray(rows)) out[id] = rows.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null && !Array.isArray(r))
      }
      return out
    } catch {
      return undefined
    }
  }

  private persist(): void {
    const key = this.storageKey
    if (!key) return
    try {
      if (Object.values(this.added.value).every((rows) => rows.length === 0)) this.storage!.removeItem(key)
      else this.storage!.setItem(key, JSON.stringify(this.added.value))
    } catch {
      // Storage full or unavailable: added rows still show until the page reloads.
    }
  }

  private entry(endPoint: string): Fetched {
    let entry = this.fetched.get(endPoint)
    if (!entry) {
      entry = { state: ref<Response>({ status: 'idle' }), request: 0 }
      this.fetched.set(endPoint, entry)
    }
    return entry
  }

  private async load(endPoint: string): Promise<void> {
    const entry = this.entry(endPoint)
    const current = ++entry.request
    entry.state.value = { status: 'loading' }
    try {
      const response = await this.fetchJson(endPoint)
      if (current === entry.request) entry.state.value = { status: 'loaded', response }
    } catch (error) {
      if (current === entry.request) entry.state.value = { status: 'error', message: error instanceof Error ? error.message : String(error) }
    }
  }

  /** The rows of a source as they load. Readers of one address share its response; each picks its own `path`. */
  rows(source: Ref<DataSource | undefined>): ComputedRef<RowsState> {
    // Start (or reuse) the fetch whenever the address changes.
    watch(
      () => (source.value && !source.value.rows ? source.value.endPoint : undefined),
      (endPoint) => {
        if (endPoint !== undefined && this.entry(endPoint).state.value.status === 'idle') void this.load(endPoint)
      },
      { immediate: true },
    )
    return computed((): RowsState => {
      const s = source.value
      if (!s) return { status: 'idle' }
      if (s.rows) return { status: 'loaded', rows: [...s.rows, ...(this.added.value[s.feature] ?? [])] }
      const state = this.entry(s.endPoint).state.value
      if (state.status !== 'loaded') return state.status === 'idle' ? { status: 'loading' } : state
      try {
        return { status: 'loaded', rows: selectRows(state.response, s.path) }
      } catch (error) {
        return { status: 'error', message: error instanceof Error ? error.message : String(error) }
      }
    })
  }

  /** Fetches a source's address again, for every reader of it. Sample data has nothing to fetch. */
  reload(source: DataSource | undefined): Promise<void> {
    return source && !source.rows ? this.load(source.endPoint) : Promise.resolve()
  }

  /** Adds a row to a resource serving sample data; every reader of it shows the row at once. */
  addSampleRow(resource: string, row: Record<string, unknown>): void {
    this.added.value = { ...this.added.value, [resource]: [...(this.added.value[resource] ?? []), { ...row }] }
    this.persist()
  }

  /** How many rows were added to a sample-data resource, and a way to remove them. */
  addedRows(resource: string): number {
    return this.added.value[resource]?.length ?? 0
  }

  clearAddedRows(resource: string): void {
    const { [resource]: _, ...rest } = this.added.value
    this.added.value = rest
    this.persist()
  }
}

export const DATA_STORE: InjectionKey<DataStore> = Symbol('dataStore')

/** Creates the document's data store and provides it to every node inside. */
export function provideDataStore(modelId?: string): DataStore {
  const storage = typeof window !== 'undefined' ? safeLocalStorage() : undefined
  const store = new DataStore(inject(FETCH_JSON, browserFetchJson), modelId, storage)
  provide(DATA_STORE, store)
  return store
}

/** The document's data store; a private one when a node is rendered on its own (tests). */
export function useDataStore(): DataStore {
  return inject(DATA_STORE, () => new DataStore(inject(FETCH_JSON, browserFetchJson)), true)
}

function safeLocalStorage(): SampleRowsStorage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}
