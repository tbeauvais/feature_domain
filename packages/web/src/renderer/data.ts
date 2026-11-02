import type { DataAction, DataSource, FormField } from '@feature-domain/engine'
import { appRowsAddress, isAppDataAddress, isModelRowsAddress, MAX_SAMPLE_ROWS, modelRowsAddress } from '@feature-domain/engine'
import {
  computed,
  getCurrentScope,
  inject,
  onBeforeUnmount,
  onScopeDispose,
  provide,
  ref,
  shallowRef,
  toRaw,
  watch,
  type ComputedRef,
  type InjectionKey,
  type Ref,
} from 'vue'
import {
  browserFetchJson,
  browserSendRequest,
  FETCH_JSON,
  selectRows,
  SEND_REQUEST,
  type DataRequest,
  type FetchJson,
  type RowsState,
  type SendRequest,
  type Via,
} from './rows'
import { currentVisitor, NoSignIn, type Visitor } from './account'

// Runtime data for a generated page: one store per document, shared by every feature reading a data resource.
// - Readers of the same address share one fetch, and `reload` refreshes all of them.
// - A resource serving sample data answers from its rows (from the model) plus rows added since (e.g. by a Form),
//   which are kept per model in the browser.

export type FetchState = { status: 'idle' } | { status: 'loading' } | { status: 'loaded'; response: unknown } | { status: 'error'; message: string }

interface Fetched {
  address: string
  /** Fetched through the Worker's proxy (the resource's Fetch through is Server). */
  proxy: boolean
  state: Ref<FetchState>
  request: number
  /** Readers of this address; with none left, its response is dropped. */
  readers: number
  /** The data resources read through it, so a change to one reloads it. */
  features: Set<string>
}

/** Where rows added to sample data are kept, per model. */
export interface SampleRowsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const STORAGE_PREFIX = 'feature-domain:sample-rows:'

/** Rows added to each sample-data resource (by instance id), and the last id each gave out (never reused). */
interface Added {
  rows: Record<string, Record<string, unknown>[]>
  lastIds: Record<string, number>
}

/** Thrown instead of sending to an address from the editor, so designing a page never changes real data. */
export class NotSentFromEditor extends Error {
  constructor(what: string, host: string) {
    super(`Nothing is ${what} from the editor${host ? ` (this would go to ${host})` : ''}. Open the preview to try it.`)
    this.name = 'NotSentFromEditor'
  }
}

/**
 * Whose data a page reads: a model's (in the editor and the preview, its draft's rows and the builder's proxy), or with
 * `app`, the published app's on its own host (its live rows and its own proxy).
 */
export interface DataSite {
  model: string
  app?: boolean
}

/**
 * Who is signed in on a published app, as far as its page knows: not asked yet, being checked, known (`visitor`: null
 * for no one), the app has no sign-in, or the check failed (`message`, in words; asked again on Try again).
 */
export type VisitorState =
  | { status: 'unknown' }
  | { status: 'checking' }
  | { status: 'known'; visitor: Visitor | null }
  | { status: 'no-sign-in' }
  | { status: 'failed'; message: string }

/**
 * Whether a page offers an action (a form, a row's Delete or change) to whoever is looking: yes, sign in first, no, or
 * not known (who is signed in is being checked, or couldn't be).
 */
export type Permission = 'yes' | 'sign-in' | 'no' | 'unknown'

export class DataStore {
  private readonly fetched = new Map<string, Fetched>()
  /** Rows added to each sample-data resource (by instance id). */
  private readonly added = shallowRef<Record<string, Record<string, unknown>[]>>({})
  /** The last id given to a row added to each sample-data resource, so a deleted row's id isn't given out again. */
  private lastIds: Record<string, number> = {}

  /** `live`: send forms and row deletes to their addresses (the preview); the editor doesn't (sample data still changes). */
  constructor(
    private readonly fetchJson: FetchJson,
    private readonly site?: DataSite,
    private readonly storage?: SampleRowsStorage,
    private readonly sendRequest: SendRequest = browserSendRequest,
    readonly live = true,
  ) {
    const stored = this.storageKey ? this.read(this.storageKey) : undefined
    if (stored) this.restore(stored)
  }

  /** Who is signed in on the app (`whoIsSignedIn` finds out; every reader of the page shares one check). */
  readonly visitor = shallowRef<VisitorState>({ status: 'unknown' })
  private visitorCheck?: Promise<Visitor | null>
  /**
   * Who added each of the app's rows the page holds, where the Worker said (only the visitor's own, where only their
   * owner may change or delete them): kept here rather than on the row, so no reader of the rows (a chart guessing
   * its fields, a text's values, an address to open) ever sees an account id.
   */
  private readonly owners = new WeakMap<object, string>()

  /**
   * The person signed in on the app, null for no one: asked once per page (the Account and the rules' controls share
   * it). Throws NoSignIn for an app without sign-in, or a SignInError when it couldn't check (asked again next time).
   */
  whoIsSignedIn(): Promise<Visitor | null> {
    if (!this.visitorCheck) {
      this.visitor.value = { status: 'checking' }
      this.visitorCheck = currentVisitor().then(
        (visitor) => ((this.visitor.value = { status: 'known', visitor }), visitor),
        (error: unknown) => {
          if (error instanceof NoSignIn) this.visitor.value = { status: 'no-sign-in' }
          else {
            this.visitorCheck = undefined
            this.visitor.value = { status: 'failed', message: error instanceof Error ? error.message : String(error) }
          }
          throw error
        },
      )
    }
    return this.visitorCheck
  }

  /**
   * Starts the check of who is signed in when an action's rule needs to know (on a published app), and it wasn't asked
   * yet. Controls call it once they are shown (never while rendering).
   */
  checkVisitorFor(action: DataAction | undefined): void {
    if (this.onApp && action?.rule && action.rule !== 'nobody' && this.visitor.value.status === 'unknown') void this.whoIsSignedIn().catch(() => undefined)
  }

  /**
   * Whether the page offers an action to whoever is looking, by its table's rule (`DataAction.rule`), for `row` when it
   * is a change or delete: only on a published app, where the Worker enforces the rules (the builder's draft rows have
   * none). Under Owner, a row is the visitor's when the Worker said so (`owners`); with no row (a Form changing a row
   * by the id typed in), anyone signed in is offered it and the Worker checks whose row it is. Unknown until
   * `checkVisitorFor` has found out who is signed in.
   */
  allows(action: DataAction, row?: unknown): Permission {
    const rule = action.rule
    if (!rule || !this.onApp) return 'yes'
    if (rule === 'nobody') return 'no'
    const state = this.visitor.value
    if (state.status === 'no-sign-in') return 'no'
    if (state.status !== 'known') return 'unknown'
    if (!state.visitor) return 'sign-in'
    return rule === 'signed-in' || row === undefined || (isRecord(row) && this.owners.get(toRaw(row)) === state.visitor.id) ? 'yes' : 'no'
  }

  /** Takes who added them off the app's rows in an answer (a list or one row), into `owners`. */
  private takeOwners(answer: unknown): void {
    if (!this.onApp) return
    for (const row of Array.isArray(answer) ? answer : [answer]) {
      if (!isRecord(row) || !Object.hasOwn(row, 'created_by')) continue
      if (typeof row.created_by === 'string') this.owners.set(row, row.created_by)
      delete row.created_by
    }
  }

  /** Whether the page is a published app's, on its own host (where its sign-in works). */
  get onApp(): boolean {
    return this.site?.app === true
  }

  private restore(stored: Added): void {
    this.added.value = stored.rows
    this.lastIds = stored.lastIds
  }

  private get storageKey(): string | undefined {
    return this.site && this.storage ? `${STORAGE_PREFIX}${this.site.model}` : undefined
  }

  /** What a model's storage holds: `{ rows, lastIds }`, or (stored before ids were remembered) the rows alone. */
  private read(key: string): Added | undefined {
    try {
      const value: unknown = JSON.parse(this.storage!.getItem(key) ?? 'null')
      if (!isRecord(value)) return undefined
      const current = isRecord(value.rows)
      const out: Added = { rows: {}, lastIds: {} }
      for (const [id, rows] of Object.entries(current ? (value.rows as Record<string, unknown>) : value)) {
        if (id === '__proto__' || !Array.isArray(rows)) continue
        out.rows[id] = rows.filter(isRecord).slice(0, MAX_SAMPLE_ROWS)
      }
      if (current && isRecord(value.lastIds)) {
        for (const [id, last] of Object.entries(value.lastIds)) if (id !== '__proto__' && Number.isSafeInteger(last)) out.lastIds[id] = last as number
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
      if (Object.values(this.added.value).every((rows) => rows.length === 0) && Object.keys(this.lastIds).length === 0) this.storage!.removeItem(key)
      else this.storage!.setItem(key, JSON.stringify({ rows: this.added.value, lastIds: this.lastIds } satisfies Added))
    } catch {
      // Storage full or unavailable: added rows still show until the page reloads.
    }
  }

  /** The fetch of an address, by the browser or through the proxy (two separate fetches, even of the same address). */
  private entry(address: string, proxy = false): Fetched {
    const key = fetchKey(address, proxy)
    let entry = this.fetched.get(key)
    if (!entry) {
      entry = { address, proxy, state: ref<FetchState>({ status: 'idle' }), request: 0, readers: 0, features: new Set() }
      this.fetched.set(key, entry)
    }
    return entry
  }

  /**
   * The address to fetch or send to: a Database table's rows (relative to the app, `tables/2/rows`) go to this model's
   * on this site, or the published app's, so a page only ever reaches its own rows; any other address as it is.
   */
  private resolve(address: string): string {
    if (!address.startsWith('tables/')) return address
    if (!isAppDataAddress(address)) throw new Error(`"${address}" isn't a Database table's rows`)
    if (!this.site) throw new Error("A Database table's rows are kept with a saved model")
    return this.site.app ? appRowsAddress(address) : modelRowsAddress(this.site.model, address)
  }

  /** How to reach the proxy for this model or app; it fetches only the stored model's (or published version's) Server addresses. */
  private via(): Via {
    if (!this.site) throw new Error('Fetching through the server needs a saved model')
    return this.site.app ? { app: true } : { model: this.site.model }
  }

  /** Fetches an address; `quiet` keeps what was loaded on show until the answer arrives (after a row is changed in place). */
  private async load(entry: Fetched, quiet = false): Promise<void> {
    const current = ++entry.request
    if (!(quiet && entry.state.value.status === 'loaded')) entry.state.value = { status: 'loading' }
    try {
      const response = await (entry.proxy ? this.fetchJson(entry.address, this.via()) : this.fetchJson(this.resolve(entry.address)))
      if (!entry.proxy && isAppDataAddress(entry.address)) this.takeOwners(response)
      if (current === entry.request) entry.state.value = { status: 'loaded', response }
    } catch (error) {
      if (current === entry.request) entry.state.value = { status: 'error', message: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * Reads the address `endPoint()` gives while the caller's scope lives: starts (or reuses) its fetch whenever it
   * changes. A failed one is tried again for a new reader; a loaded or loading one is shared. Each reader counts on its
   * address, and an address no one reads any more is dropped.
   */
  private track(target: () => { address: string; proxy?: boolean } | undefined, feature?: () => string | undefined): void {
    let current: string | undefined
    const release = () => {
      if (current === undefined) return
      const entry = this.fetched.get(current)
      if (entry && --entry.readers <= 0) {
        entry.request++ // a response still on its way is discarded
        this.fetched.delete(current)
      }
      current = undefined
    }
    watch(
      () => {
        const t = target()
        return t && fetchKey(t.address, t.proxy)
      },
      () => {
        release()
        const t = target()
        if (t === undefined) return
        const entry = this.entry(t.address, t.proxy)
        entry.readers++
        const id = feature?.()
        if (id !== undefined) entry.features.add(id)
        current = fetchKey(t.address, t.proxy)
        if (entry.state.value.status === 'idle' || entry.state.value.status === 'error') void this.load(entry)
      },
      { immediate: true },
    )
    if (getCurrentScope()) onScopeDispose(release)
  }

  /** The JSON at an address as it loads (e.g. a Weather card's forecast), shared with every reader of it. */
  json(endPoint: Ref<string | undefined>): ComputedRef<FetchState> {
    this.track(() => (endPoint.value === undefined ? undefined : { address: endPoint.value }))
    return computed((): FetchState => {
      if (endPoint.value === undefined) return { status: 'idle' }
      const state = this.entry(endPoint.value).state.value
      return state.status === 'idle' ? { status: 'loading' } : state
    })
  }

  /**
   * A source's whole answer as it loads, for values read out of it (a Text's {{path}}): the JSON at its address, or for
   * sample data its rows with any added since.
   */
  answer(source: Ref<DataSource | undefined>): ComputedRef<FetchState> {
    // Read through the resource like a table's rows, so a change made through it (a Form's send) reloads this too.
    this.track(
      () => fetchTarget(source.value),
      () => source.value?.feature,
    )
    return computed((): FetchState => {
      const s = source.value
      if (!s) return { status: 'idle' }
      if (s.rows) return { status: 'loaded', response: [...s.rows, ...(this.added.value[s.feature] ?? [])] }
      const state = this.entry(s.endPoint, s.proxy).state.value
      return state.status === 'idle' ? { status: 'loading' } : state
    })
  }

  /** Fetches an address again, for every reader of it. */
  refetch(endPoint: string | undefined): Promise<void> {
    return endPoint === undefined ? Promise.resolve() : this.load(this.entry(endPoint))
  }

  /** The rows of a source as they load. Readers of one address share its response; each picks its own `path`. */
  rows(source: Ref<DataSource | undefined>): ComputedRef<RowsState> {
    this.track(
      () => fetchTarget(source.value),
      () => source.value?.feature,
    )
    return computed((): RowsState => {
      const s = source.value
      if (!s) return { status: 'idle' }
      if (s.rows) return { status: 'loaded', rows: [...s.rows, ...(this.added.value[s.feature] ?? [])] }
      const state = this.entry(s.endPoint, s.proxy).state.value
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
    return source && !source.rows ? this.load(this.entry(source.endPoint, source.proxy)) : Promise.resolve()
  }

  /**
   * Adds a row to a resource serving sample data; every reader of it shows the row at once. Like the model's own rows,
   * at most MAX_SAMPLE_ROWS are added; returns false when full.
   */
  addSampleRow(resource: string, row: Record<string, unknown>): boolean {
    const rows = this.added.value[resource] ?? []
    if (rows.length >= MAX_SAMPLE_ROWS) return false
    this.added.value = { ...this.added.value, [resource]: [...rows, Object.fromEntries(Object.entries(row))] }
    this.persist()
    return true
  }

  /** How many rows were added to a sample-data resource, and a way to remove them. */
  addedRows(resource: string): number {
    return this.added.value[resource]?.length ?? 0
  }

  clearAddedRows(resource: string): void {
    const { [resource]: _, ...rest } = this.added.value
    this.added.value = rest
    const { [resource]: __, ...lastIds } = this.lastIds
    this.lastIds = lastIds
    this.persist()
  }

  /** Fetches again every address a data resource is read through (after it was changed); `quiet` as for `load`. */
  async reloadResource(resource: string, quiet = false): Promise<void> {
    await Promise.all([...this.fetched.values()].filter((entry) => entry.features.has(resource)).map((entry) => this.load(entry, quiet)))
  }

  /**
   * Sends a form's values: on sample data as an added row; otherwise to the operation's address, path fields filling
   * its `{name}` placeholders, query fields added to it and the rest as the body. Then every reader of the resource
   * reloads (`waitForReload: false` returns without waiting for it, e.g. when the page is about to be left). Returns
   * what was created: the added row, or the site's answer. Throws, in words, when it can't.
   */
  async send(
    action: DataAction,
    values: Readonly<Record<string, unknown>>,
    fields: readonly FormField[],
    { waitForReload = true }: { waitForReload?: boolean } = {},
  ): Promise<unknown> {
    const where = (field: string) => fields.find((f) => f.name === field)?.in ?? 'body'
    const body = Object.fromEntries(Object.entries(values).filter(([k]) => where(k) === 'body'))
    if (action.sample) {
      const row = withSampleId(body, action, this.added.value[action.feature] ?? [], this.lastIds[action.feature])
      if (action.sampleIds) {
        const id = Number(row[action.sampleIds.field])
        if (Number.isSafeInteger(id) && id > (this.lastIds[action.feature] ?? -Infinity)) this.lastIds = { ...this.lastIds, [action.feature]: id }
      }
      if (!this.addSampleRow(action.feature, row)) throw new Error(`At most ${MAX_SAMPLE_ROWS} rows can be added`)
      return row
    }
    if (!this.live) throw new NotSentFromEditor('sent', hostOf(action.endPoint))
    let url = fillPath(action.endPoint, values)
    const query = Object.entries(values).filter(([k, v]) => where(k) === 'query' && v !== undefined && v !== '')
    if (query.length > 0)
      url += `${url.includes('?') ? '&' : '?'}${query.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')}`
    // After the query, so a Database table's rows (which take none) refuse one rather than send it elsewhere.
    url = this.resolve(url)
    const request: DataRequest = { method: action.method, url, body }
    if (action.requestType) request.requestType = action.requestType
    const answer = await (action.proxy ? this.sendRequest(request, this.via()) : this.sendRequest(request))
    if (!action.proxy && isAppDataAddress(action.endPoint)) this.takeOwners(answer)
    // Loading never throws: a failed reload shows on its readers.
    const reloaded = this.reloadResource(action.feature)
    if (waitForReload) await reloaded
    return answer
  }

  /**
   * Whether a row can be deleted: any fetched row the table's rule lets the visitor delete, but only rows added to sample
   * data (the model's own are the sample).
   */
  canDelete(action: DataAction, row: unknown): boolean {
    if (action.sample) return (this.added.value[action.feature] ?? []).includes(row as Record<string, unknown>)
    return this.allows(action, row) === 'yes'
  }

  /** Deletes a row (its values fill the address's placeholders), then every reader of the resource reloads. */
  async delete(action: DataAction, row: unknown): Promise<void> {
    if (action.sample) {
      const rows = this.added.value[action.feature] ?? []
      this.added.value = { ...this.added.value, [action.feature]: rows.filter((r) => r !== row) }
      this.persist()
      return
    }
    if (!this.live) throw new NotSentFromEditor('deleted', hostOf(action.endPoint))
    const request: DataRequest = {
      method: action.method,
      url: this.resolve(fillPath(action.endPoint, typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : {})),
    }
    await (action.proxy ? this.sendRequest(request, this.via()) : this.sendRequest(request))
    await this.reloadResource(action.feature)
  }

  /**
   * Changes fields of a row in place (a table's select): sends only `changes` to the row's address (its placeholders
   * filled from the row), then every reader of the resource reloads, keeping the rows on show meanwhile.
   */
  async update(action: DataAction, row: unknown, changes: Readonly<Record<string, unknown>>): Promise<void> {
    if (action.sample) throw new Error("Sample rows can't be changed in place")
    if (!this.live) throw new NotSentFromEditor('changed', hostOf(action.endPoint))
    const request: DataRequest = {
      method: action.method,
      url: this.resolve(fillPath(action.endPoint, typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : {})),
      body: { ...changes },
    }
    if (action.requestType) request.requestType = action.requestType
    await (action.proxy ? this.sendRequest(request, this.via()) : this.sendRequest(request))
    await this.reloadResource(action.feature, true)
  }

  /** Follows rows added in another tab (e.g. the editor while this is the preview). Returns a function to stop. */
  follow(): () => void {
    const key = this.storageKey
    if (!key || typeof window === 'undefined') return () => {}
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) this.restore(this.read(key) ?? { rows: {}, lastIds: {} })
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }
}

/** The key of a fetch: its address, and whether it goes through the proxy. */
const fetchKey = (address: string, proxy = false) => `${proxy ? 'server' : 'browser'} ${address}`

/** What a source fetches (none for sample data, which has rows). */
const fetchTarget = (source: DataSource | undefined) => (source && !source.rows ? { address: source.endPoint, proxy: source.proxy } : undefined)

/**
 * A row added to sample data, given the next id when it has none: after the model's rows, those added since and any
 * given out before (a deleted row's id isn't reused, as a server wouldn't).
 */
function withSampleId(row: Record<string, unknown>, action: DataAction, added: readonly Record<string, unknown>[], last = -Infinity): Record<string, unknown> {
  const ids = action.sampleIds
  if (!ids || (row[ids.field] !== undefined && row[ids.field] !== '')) return row
  const taken = added.map((r) => Number(r[ids.field])).filter((n) => Number.isSafeInteger(n))
  const next = Math.max(ids.after, last, ...taken) + 1
  // The id first, as the sample's rows have it.
  return { [ids.field]: ids.text ? String(next) : next, ...row }
}

/** An address with its `{name}` placeholders filled from values (encoded); a missing value is a problem, in words. */
export function fillPath(endPoint: string, values: Readonly<Record<string, unknown>>): string {
  return endPoint.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = Object.hasOwn(values, name) ? values[name] : undefined
    if (value === undefined || value === null || value === '') throw new Error(`No value for "${name}" to fill the address`)
    // "." and ".." aren't encoded, and would move the address up a level (/sales/.. is /).
    if (/^\.{1,2}$/.test(String(value))) throw new Error(`"${String(value)}" can't fill "${name}" in the address`)
    return encodeURIComponent(String(value))
  })
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const hostOf = (url: string) => /^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? ''

/** Forgets the rows added to a model's sample data, e.g. when the model is deleted. */
export function forgetSampleRows(modelId: string, storage: SampleRowsStorage | undefined = safeLocalStorage()): void {
  try {
    storage?.removeItem(`${STORAGE_PREFIX}${modelId}`)
  } catch {
    // Unavailable storage holds nothing to forget.
  }
}

export const DATA_STORE: InjectionKey<DataStore> = Symbol('dataStore')

/**
 * What to wait for before a request the Worker answers from the stored model: one through the proxy, which fetches only
 * the stored model's Server addresses, or to a Database table's rows, checked against the stored table's fields. The
 * editor's pending save, so an address just typed (or a field just added) is stored first. Resolves to false when the
 * edits could not be stored.
 */
export const PROXY_READY: InjectionKey<() => Promise<boolean>> = Symbol('proxyReady')

/** Waits for `ready`, refusing to go on when the model isn't stored: the proxy would check a stale copy. */
export async function proxyReady(ready: () => Promise<boolean>): Promise<void> {
  if (!(await ready())) throw new Error("The model isn't saved; resolve the save problem first")
}

/** Creates the document's data store and provides it to every node inside; `live` as for DataStore. */
export function provideDataStore(site?: DataSite, live = true): DataStore {
  const storage = typeof window !== 'undefined' ? safeLocalStorage() : undefined
  const ready = inject(PROXY_READY, undefined)
  const fetchJson = inject(FETCH_JSON, browserFetchJson)
  const sendRequest = inject(SEND_REQUEST, browserSendRequest)
  const store = new DataStore(
    ready ? async (url, via) => (via || isModelRowsAddress(url) ? (await proxyReady(ready), fetchJson(url, via)) : fetchJson(url)) : fetchJson,
    site,
    storage,
    ready
      ? async (request, via) => (via || isModelRowsAddress(request.url) ? (await proxyReady(ready), sendRequest(request, via)) : sendRequest(request))
      : sendRequest,
    live,
  )
  provide(DATA_STORE, store)
  // Rows added in another tab (the editor, while this is the preview) show here too.
  onBeforeUnmount(store.follow())
  return store
}

/** The document's data store; a private one when a node is rendered on its own (tests). */
export function useDataStore(): DataStore {
  return inject(DATA_STORE, () => new DataStore(inject(FETCH_JSON, browserFetchJson), undefined, undefined, inject(SEND_REQUEST, browserSendRequest)), true)
}

function safeLocalStorage(): SampleRowsStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}
