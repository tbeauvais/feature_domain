import type { DataSource } from '@feature-domain/engine'
import type { InjectionKey, Ref } from 'vue'
import { useDataStore } from './data'
import { getPath } from './filters'
import { isHttpUrl } from './urls'

export type FetchJson = (url: string) => Promise<unknown>

/**
 * How tables load their rows. Runtime data bindings fetch directly from the data resource for now; phase 3 routes
 * this through the Worker's allow-listed /api/proxy. Tests provide a fake.
 */
export const FETCH_JSON: InjectionKey<FetchJson> = Symbol('fetchJson')

export const browserFetchJson: FetchJson = async (url) => {
  // Never fetch relative or non-http URLs: an empty endpoint would otherwise load this app's own HTML.
  if (!isHttpUrl(url)) throw new Error(`Only http(s) URLs can be loaded, not "${url}"`)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
  return response.json()
}

export type TableSource = DataSource

export type RowsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; rows: unknown[] }
  | { status: 'error'; message: string }

/** The rows at `source.path` of the response (the whole response when there is no path), which must be a list. */
export function selectRows(response: unknown, path?: string): unknown[] {
  const rows = path ? getPath(response, path) : response
  if (!Array.isArray(rows)) throw new Error(path ? `"${path}" in the response is not a list` : 'The response is not a list')
  return rows
}

/** A table's rows as they load (shared with every reader of the same resource), and `reload` to fetch them again. */
export function useTableRows(source: Ref<TableSource | undefined>): { state: Ref<RowsState>; reload: () => Promise<void> } {
  const store = useDataStore()
  return { state: store.rows(source), reload: () => store.reload(source.value) }
}
