import type { DataSource } from '@feature-domain/engine'
import type { InjectionKey, Ref } from 'vue'
import { useDataStore } from './data'
import { getPath } from './filters'
import { isHttpUrl } from './urls'

/**
 * Sends a request through the Worker's /api/v1/proxy instead of from the browser (a resource whose Fetch through is
 * Server), for sites that don't let other pages read them. The proxy fetches only the stored model's Server addresses.
 */
export interface Via {
  model: string
}

export type FetchJson = (url: string, via?: Via) => Promise<unknown>

/** How data resources are read: by the browser, or through the proxy (`via`). Tests provide a fake. */
export const FETCH_JSON: InjectionKey<FetchJson> = Symbol('fetchJson')

export const browserFetchJson: FetchJson = async (url, via) => {
  // Never fetch relative or non-http URLs: an empty endpoint would otherwise load this app's own HTML.
  if (!isHttpUrl(url)) throw new Error(`Only http(s) URLs can be loaded, not "${url}"`)
  if (via) return readJson(await proxied({ method: 'GET', url }, via))
  let response: Response
  try {
    response = await fetch(url)
  } catch {
    // The browser says no more than this when a site doesn't let other pages read it (CORS), or can't be reached.
    throw new Error("Couldn't load it. If the site doesn't let other pages read its data, set the data resource's Fetch through to Server.")
  }
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
  return readJson(response)
}

/** The JSON a site answered with, or an error in words when it answered with something else (or nothing). */
async function readJson(response: Response): Promise<unknown> {
  try {
    return JSON.parse(await response.text())
  } catch (error) {
    throw new Error("The site didn't answer with JSON", { cause: error })
  }
}

/** The path of the Worker's proxy, on this site. */
export const PROXY_PATH = '/api/v1/proxy'

/** How long a request through the proxy may take: the proxy's own limit (10 s) plus the way there and back. */
const PROXY_TIMEOUT_MS = 20_000

/**
 * The site's answer to a request sent through the proxy. Throws, in words, when the proxy refused it or the site
 * answered with an error.
 */
async function proxied(request: DataRequest, via: Via): Promise<Response> {
  let response: Response
  try {
    response = await fetch(PROXY_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ model: via.model, ...request }),
      // An expired Cloudflare Access session answers with a redirect to its sign-in page.
      redirect: 'manual',
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    })
  } catch (error) {
    throw new Error(error instanceof DOMException && error.name === 'TimeoutError' ? "The server didn't answer in time" : "Couldn't reach the server", {
      cause: error,
    })
  }
  // A page that isn't the site's answer (marked by the proxy) is Access's sign-in page; the site's own pages are its errors.
  const signInPage = response.headers.get(PROXY_ANSWER_HEADER) !== 'site' && response.headers.get('Content-Type')?.startsWith('text/html')
  if (response.type === 'opaqueredirect' || signInPage) throw new Error('Your sign-in has expired; reload the page to sign in again')
  if (response.headers.get(PROXY_ERROR_HEADER)) {
    const answer = (await response.json().catch(() => ({}))) as { error?: unknown }
    throw new Error(typeof answer.error === 'string' ? answer.error : `The server refused it (${response.status})`)
  }
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
  return response
}

/** Mark the proxy's own errors and the site's answers it passes on (packages/worker/src/proxy.ts). */
const PROXY_ERROR_HEADER = 'X-Proxy-Error'
const PROXY_ANSWER_HEADER = 'X-Proxy-Answer'

/** A request that changes data (a Form's submit, a row's delete). The body goes as JSON unless `requestType` says a form. */
export interface DataRequest {
  method: string
  url: string
  body?: Record<string, unknown>
  requestType?: 'form' | 'multipart'
}
export type SendRequest = (request: DataRequest, via?: Via) => Promise<unknown>

/** How forms and row deletes reach a data resource; tests provide a fake. Only http(s) addresses are ever sent to. */
export const SEND_REQUEST: InjectionKey<SendRequest> = Symbol('sendRequest')

export const browserSendRequest: SendRequest = async (request, via) => {
  if (!isHttpUrl(request.url)) throw new Error(`Only http(s) URLs can be sent to, not "${request.url}"`)
  let response: Response
  if (via) response = await proxied(request, via)
  else {
    try {
      response = await fetch(request.url, requestInit(request))
    } catch {
      throw new Error("Couldn't send it. If the site doesn't take requests from other pages, set the data resource's Fetch through to Server.")
    }
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
  }
  const text = await response.text()
  try {
    return text ? JSON.parse(text) : undefined
  } catch {
    return text
  }
}

/** The fetch options for a request: the body form-encoded, as multipart form data (the browser sets its boundary) or JSON. */
export function requestInit({ method, body, requestType }: DataRequest): RequestInit {
  const init: RequestInit = { method }
  if (body) {
    const pairs = Object.entries(body).map(([k, v]): [string, string] => [k, v === undefined || v === null ? '' : String(v)])
    if (requestType === 'form') init.body = new URLSearchParams(pairs)
    else if (requestType === 'multipart') {
      const data = new FormData()
      for (const [k, v] of pairs) data.append(k, v)
      init.body = data
    } else {
      init.headers = { 'Content-Type': 'application/json' }
      init.body = JSON.stringify(body)
    }
  }
  return init
}

export type TableSource = DataSource

export type RowsState = { status: 'idle' } | { status: 'loading' } | { status: 'loaded'; rows: unknown[] } | { status: 'error'; message: string }

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
