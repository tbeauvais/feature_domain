import { ModelConflictError, ModelNotFoundError, type AppModel, type ModelStore, type ModelSummary, type StoredModel } from '@feature-domain/engine'
import { isSignInAnswer } from '../lib/signIn'

/** The Worker's model API (packages/worker/src/app.ts). */
export const MODELS_PATH = '/api/v1/models'

/** The id the home page's model is stored under (the Worker's HOME_ID); the model list leaves it out. */
export const HOME_ID = 'home'

/** Where the Worker puts the built-in home page back. */
export const HOME_RESET_PATH = '/api/v1/home/reset'

/**
 * Browsers cap the bodies of `keepalive` requests (which may outlive the page) at 64 KiB in all, so only saves smaller
 * than this are sent that way; a larger save can still be cut off when the page closes.
 */
export const KEEPALIVE_MAX_BYTES = 60_000

/**
 * How long a request may take before it counts as failed: `fetch` never gives up on its own, and a save that never
 * ends would hold every later one (and leaving the model) forever. A save sent as the page closes is not cut off: the
 * page's timers end with it.
 */
export const REQUEST_TIMEOUT_MS = 30_000

/** A request the API refused or failed, with the message it gave. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * The API answered with Cloudflare Access's sign-in instead (a redirect, which `fetch` can't follow across sites): the
 * session expired, and only reloading the page signs in again.
 */
export class SignedOutError extends Error {
  constructor() {
    super('your sign-in has expired; reload the page to sign in again')
    this.name = 'SignedOutError'
  }
}

/**
 * The revision an ETag names. The API sends strong tags (`"3"`); Cloudflare's edge weakens them (`W/"3"`) when it
 * compresses a response, so both are read.
 */
export function revisionOf(etag: string | null): number | undefined {
  const match = etag === null ? null : /^(?:W\/)?"([1-9][0-9]{0,14})"$/.exec(etag.trim())
  return match ? Number(match[1]) : undefined
}

/**
 * Models stored by the Worker (D1), through its HTTP API. Every response is checked before it is used: anything but
 * the JSON the API sends becomes an error, never a model (the document store also validates every model it loads).
 */
export class ApiModelStore implements ModelStore {
  constructor(private readonly fetch: typeof globalThis.fetch = (...args) => globalThis.fetch(...args)) {}

  async list(): Promise<ModelSummary[]> {
    const body = await this.json(await this.request(MODELS_PATH))
    if (!Array.isArray(body) || !body.every(isSummary)) throw unexpected()
    return body.map(({ id, name, updated_at }) => ({ id, name, updatedAt: updated_at }))
  }

  async get(id: string): Promise<StoredModel | null> {
    // The browser keeps the last answer and asks again with its ETag, so an unchanged model costs a 304.
    const response = await this.request(path(id))
    if (response.status === 404) return null
    const model = await this.json(response)
    const revision = revisionOf(response.headers.get('ETag'))
    if (typeof model !== 'object' || model === null || Array.isArray(model) || revision === undefined) throw unexpected()
    return { model: model as AppModel, revision }
  }

  async create(model: AppModel): Promise<string> {
    const body = await this.json(await this.request(MODELS_PATH, { method: 'POST', ...send(model) }))
    const id = typeof body === 'object' && body !== null ? (body as { id?: unknown }).id : undefined
    if (typeof id !== 'string') throw unexpected()
    return id
  }

  async update(id: string, model: AppModel, ifRevision?: number): Promise<number> {
    const init = send(model)
    const keepalive = new TextEncoder().encode(init.body).length < KEEPALIVE_MAX_BYTES
    const headers = ifRevision === undefined ? init.headers : { ...init.headers, 'If-Match': `"${ifRevision}"` }
    const response = await this.request(path(id), { method: 'PUT', ...init, headers, keepalive })
    if (response.status === 404) throw new ModelNotFoundError(id)
    if (response.status === 412) {
      const stored = revisionOf(response.headers.get('ETag'))
      if (stored === undefined) throw unexpected()
      throw new ModelConflictError(id, stored)
    }
    await this.ok(response)
    const revision = revisionOf(response.headers.get('ETag'))
    if (revision === undefined) throw unexpected()
    return revision
  }

  async delete(id: string): Promise<void> {
    await this.ok(await this.request(path(id), { method: 'DELETE' }))
  }

  /** Puts the built-in home page back, over a stored one or in place of a deleted one. */
  async resetHome(): Promise<void> {
    await this.ok(await this.request(HOME_RESET_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }))
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    // `manual`: an expired Access session answers with a redirect to its sign-in page, which must not be followed.
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, REQUEST_TIMEOUT_MS)
    let response: Response
    try {
      response = await this.fetch(url, { ...init, redirect: 'manual', signal: controller.signal, headers: { Accept: 'application/json', ...init.headers } })
    } catch (e) {
      if (timedOut) throw new ApiError(0, 'the server did not answer in time')
      throw e
    } finally {
      clearTimeout(timer)
    }
    if (isSignInAnswer(response)) throw new SignedOutError()
    return response
  }

  /** Throws the API's error for a failed response. */
  private async ok(response: Response): Promise<void> {
    if (response.ok) return
    let message = `the server answered ${response.status}`
    if (isJson(response)) {
      const body: unknown = await response.json().catch(() => undefined)
      if (typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string') message = (body as { error: string }).error
    }
    throw new ApiError(response.status, message)
  }

  /** The response's JSON, which each caller checks. */
  private async json(response: Response): Promise<unknown> {
    await this.ok(response)
    // Something in front of the Worker (Access's sign-in page) answered with HTML.
    if (!isJson(response)) throw new SignedOutError()
    return response.json().catch(() => {
      throw unexpected()
    })
  }
}

/** A model in the API's list: its times are `updated_at`. */
interface ListedModel {
  id: string
  name: string
  updated_at: string
}

const isSummary = (m: unknown): m is ListedModel =>
  typeof m === 'object' &&
  m !== null &&
  typeof (m as ListedModel).id === 'string' &&
  typeof (m as ListedModel).name === 'string' &&
  typeof (m as ListedModel).updated_at === 'string'
const path = (id: string) => `${MODELS_PATH}/${encodeURIComponent(id)}`
const send = (model: AppModel) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(model) })
const isJson = (response: Response) => response.headers.get('Content-Type')?.toLowerCase().startsWith('application/json') ?? false
const unexpected = () => new ApiError(0, 'the server sent an answer the editor does not understand')
