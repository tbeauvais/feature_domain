import {
  databaseTableKeys,
  databaseTables,
  ModelConflictError,
  ModelNotFoundError,
  newModel,
  RowLimitError,
  validateModel,
  type AppModel,
  type RowStore,
  type ServerModelStore,
} from '@feature-domain/engine'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { D1ModelStore, toJson } from './d1ModelStore'
import { D1RowStore } from './d1RowStore'
import type { Env } from './env'
import { HOME_ID, homeModel } from './home'
import { MODELS_API_SPEC } from './openapi'
import { allowedOrigins, forward, PROXY_ERROR_HEADER, PROXY_LIMITS, ProxyError, readProxyRequest } from './proxy'
import { limitError, MAX_ROW_REQUEST_BYTES, readRow, rowIdOf, RowsError, tableOf } from './rows'

/**
 * The largest model the API accepts: bytes of the request body, and of the row D1ModelStore stores (the JSON plus the
 * name, which has a column of its own). D1 rows hold at most 2,000,000 bytes on Cloudflare (local D1 doesn't check),
 * and a model can carry an API spec of up to 1 MB (the engine's MAX_SPEC_CHARS) plus sample rows.
 */
export const MAX_MODEL_BYTES = 1_900_000

/** Security headers on every /api response, errors included. */
export const API_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}

type AppEnv = { Bindings: Env; Variables: { store: ServerModelStore } }

/**
 * The Worker's HTTP API. Every response under /api is JSON; errors are `{ error, problems? }`. `store` replaces the D1
 * store (tests); by default each request uses the DB binding.
 *
 * A model's revision is its ETag (`"3"`). GET answers `If-None-Match` with a 304 when the model is unchanged, so
 * checking for changes is cheap. PUT with `If-Match` saves only over that revision (else 412, with the stored revision
 * as the ETag); PUT without it overwrites.
 *
 * POST /proxy fetches an address for a page (src/proxy.ts); `upstream` replaces the fetch it uses (tests).
 *
 * /models/:id/tables/:table/rows reads and writes a Database table's rows (src/rows.ts); `rows` replaces the D1 row
 * store (tests).
 */
export function createApp(store?: (env: Env) => ServerModelStore, upstream: typeof fetch = (...args) => fetch(...args), rows?: (env: Env) => RowStore) {
  const app = new Hono<AppEnv>()
  const api = new Hono<AppEnv>()
  const originsOf = revisionCache(allowedOrigins)
  const tablesOf = revisionCache((model) => databaseTables(model))
  // Rows live beside the models, in D1 unless a row store is given (tests).
  const rowStoreOf = (c: Context<AppEnv>) => (rows ? rows(c.env) : new D1RowStore(c.env.DB))
  // A Database table removed by a save takes its draft rows with it, so a table added later under the same instance id
  // (the engine numbers new features after the highest id) starts empty. The save has landed by then, so a failure here
  // is only logged (the next save tries again): answering it as an error would make the editor retry an old revision.
  const forgetRemovedTables = async (c: Context<AppEnv>, id: string, model: AppModel) => {
    try {
      await rowStoreOf(c).keepTables(id, 'draft', databaseTableKeys(model))
    } catch (e) {
      console.error(e)
    }
  }

  // API answers are data, never pages: nothing in them may run, load or be framed. (The app's pages get their policy
  // from packages/web/public/_headers.)
  app.use('/api/*', async (c, next) => {
    try {
      await next()
    } finally {
      for (const [name, value] of Object.entries(API_HEADERS)) c.res.headers.set(name, value)
    }
  })

  api.use(async (c, next) => {
    c.set('store', store ? store(c.env) : new D1ModelStore(c.env.DB))
    await next()
  })

  // The home page's model is left out: it is the page showing this list, opened by its "Edit home page" link.
  api.get('/models', async (c) => {
    const models = (await c.var.store.list()).filter((m) => m.id !== HOME_ID)
    return c.json(
      models.map(({ id, name, updatedAt }) => ({ id, name, updated_at: updatedAt })),
      200,
      { 'Cache-Control': 'no-cache' },
    )
  })

  api.post('/models', limit, async (c) => {
    const model = await readModel(c.req.raw, true)
    if (model instanceof Response) return model
    const id = await c.var.store.create(model)
    // Every store creates models at revision 1 (the ModelStore contract checks it).
    return c.json({ id }, 201, { Location: `/api/v1/models/${encodeURIComponent(id)}`, ETag: etag(1) })
  })

  api.get('/models/:id', async (c) => {
    const stored = await c.var.store.get(c.req.param('id'))
    if (!stored) return notFound()
    const headers = { ETag: etag(stored.revision), 'Cache-Control': 'no-cache' }
    if (noneMatch(c.req.header('If-None-Match'), stored.revision)) return c.body(null, 304, headers)
    return c.json(stored.model, 200, headers)
  })

  api.put('/models/:id', limit, async (c) => {
    const ifMatch = c.req.header('If-Match')
    const ifRevision = ifMatch === undefined ? undefined : matchRevision(ifMatch)
    if (ifRevision === null) return error(400, 'If-Match must be "*" or one revision, as the ETag gave it')
    const model = await readModel(c.req.raw)
    if (model instanceof Response) return model
    let revision: number
    try {
      revision = await c.var.store.update(c.req.param('id'), model, ifRevision)
      await forgetRemovedTables(c, c.req.param('id'), model)
    } catch (e) {
      if (e instanceof ModelNotFoundError) return notFound()
      if (e instanceof ModelConflictError) return error(412, 'The model was changed since this revision', { headers: { ETag: etag(e.revision) } })
      throw e
    }
    return c.body(null, 204, { ETag: etag(revision) })
  })

  api.delete('/models/:id', async (c) => {
    const id = c.req.param('id')
    await c.var.store.delete(id)
    await rowStoreOf(c).deleteModel(id)
    // A model stored again under this id (the home page's) starts at revision 1 again, so nothing cached for it holds.
    originsOf.forget(id)
    tablesOf.forget(id)
    return c.body(null, 204)
  })

  api.get('/openapi.json', (c) => c.json(MODELS_API_SPEC))

  // Puts the built-in home page back, over whatever is stored (a broken one) or in place of a deleted one. Only as
  // application/json, like every other request that changes data, so a form on another site can't send it.
  api.post('/home/reset', async (c) => {
    if (!c.req.header('Content-Type')?.toLowerCase().startsWith('application/json')) return error(415, 'Send the request as application/json')
    const model = homeModel()
    const revision = await c.var.store.put(HOME_ID, model)
    await forgetRemovedTables(c, HOME_ID, model)
    return c.body(null, 204, { ETag: etag(revision) })
  })

  api.post('/proxy', proxyLimit, async (c) => {
    try {
      if (!c.req.header('Content-Type')?.toLowerCase().startsWith('application/json')) throw new ProxyError(400, 'Send the request as application/json')
      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        throw new ProxyError(400, 'The body is not valid JSON')
      }
      const request = readProxyRequest(body)
      const stored = await c.var.store.get(request.model)
      if (!stored) throw new ProxyError(404, 'No model with this id')
      return await forward(request, originsOf(request.model, stored.revision, stored.model), new URL(c.req.url).hostname, upstream)
    } catch (e) {
      if (e instanceof ProxyError) return proxyError(e.status, e.message)
      throw e
    }
  })

  // A Database table's rows: the draft's, read and written by the editor's canvas and the preview. Only as
  // application/json, so a form on another site can't send them.
  const ROWS = '/models/:id/tables/:table/rows'
  /** The table a rows request names, and the row store; `sample`: store its sample rows if they never were. */
  const resolveTable = async (c: Context<AppEnv>, sample: boolean) => {
    const rowStore = rowStoreOf(c)
    return { ...(await tableOf(c.var.store, rowStore, tablesOf, c.req.param('id')!, c.req.param('table')!, sample)), rowStore }
  }

  api.get(ROWS, (c) =>
    rowsAnswer(async () => {
      const { ref, rowStore } = await resolveTable(c, true)
      return c.json(await rowStore.list(ref), 200, { 'Cache-Control': 'no-store' })
    }),
  )

  api.post(ROWS, rowLimit, (c) =>
    rowsAnswer(async () => {
      const { ref, table, rowStore } = await resolveTable(c, true)
      const { row } = await readRow(c.req.raw, table, false)
      const created = await rowStore.create(ref, row)
      const location = `/api/v1/models/${encodeURIComponent(ref.model)}/tables/${ref.table}/rows/${created.id}`
      return c.json(created, 201, { Location: location })
    }),
  )

  api.get(`${ROWS}/:row`, (c) =>
    rowsAnswer(async () => {
      const { ref, rowStore } = await resolveTable(c, false)
      const row = await rowStore.get(ref, rowIdOf(c.req.param('row')))
      if (!row) throw new RowsError(404, 'No row with this id')
      return c.json(row, 200, { 'Cache-Control': 'no-store' })
    }),
  )

  api.patch(`${ROWS}/:row`, rowLimit, (c) =>
    rowsAnswer(async () => {
      const { ref, table, rowStore } = await resolveTable(c, false)
      const id = rowIdOf(c.req.param('row'))
      const { row, cleared } = await readRow(c.req.raw, table, true)
      const changed = await rowStore.update(ref, id, row, cleared)
      if (!changed) throw new RowsError(404, 'No row with this id')
      return c.json(changed)
    }),
  )

  api.delete(`${ROWS}/:row`, (c) =>
    rowsAnswer(async () => {
      const { ref, rowStore } = await resolveTable(c, false)
      await rowStore.delete(ref, rowIdOf(c.req.param('row')))
      return c.body(null, 204)
    }),
  )

  api.all(ROWS, () => error(405, 'Method not allowed', { allow: 'GET, POST' }))
  api.all(`${ROWS}/:row`, () => error(405, 'Method not allowed', { allow: 'GET, PATCH, DELETE' }))
  api.all('/models', () => error(405, 'Method not allowed', { allow: 'GET, POST' }))
  api.all('/models/:id', () => error(405, 'Method not allowed', { allow: 'GET, PUT, DELETE' }))
  api.all('/proxy', () => proxyError(405, 'Method not allowed', 'POST'))
  api.all('/openapi.json', () => error(405, 'Method not allowed', { allow: 'GET' }))
  api.all('/home/reset', () => error(405, 'Method not allowed', { allow: 'POST' }))

  app.route('/api/v1', api)
  app.all('/api/*', () => error(404, 'No such API endpoint'))
  app.onError((err) => {
    console.error(err)
    return error(500, 'Something went wrong on the server')
  })
  return app
}

const tooLarge = () => error(413, `Models are limited to ${MAX_MODEL_BYTES} bytes`)
const limit = bodyLimit({ maxSize: MAX_MODEL_BYTES, onError: tooLarge })
const bytes = (value: string) => new TextEncoder().encode(value).length

/**
 * The request's model, or the error response to send instead. With `named`, a body that is only `{ name }` (what a
 * form sends) starts a new model with one empty page.
 */
async function readModel(request: Request, named = false): Promise<AppModel | Response> {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    return error(415, 'Send the model as application/json')
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return error(400, 'The body is not valid JSON')
  }
  if (named && isNameOnly(body)) {
    if (typeof body.name !== 'string' || body.name.trim() === '') return error(400, 'The model is not valid', { problems: ['Give the model a name'] })
    body = newModel(body.name)
  }
  const problems = validateModel(body)
  if (problems.length > 0) return error(400, 'The model is not valid', { problems })
  const model = body as AppModel
  return bytes(toJson(model)) + bytes(model.name) > MAX_MODEL_BYTES ? tooLarge() : model
}

/** A body that names a model but holds none of one: no version or features. */
const isNameOnly = (body: unknown): body is { name: unknown } =>
  typeof body === 'object' &&
  body !== null &&
  !Array.isArray(body) &&
  Object.hasOwn(body, 'name') &&
  !Object.hasOwn(body, 'version') &&
  !Object.hasOwn(body, 'features')

const proxyLimit = bodyLimit({
  maxSize: PROXY_LIMITS.requestBytes,
  onError: () => proxyError(413, `Requests through the proxy are limited to ${PROXY_LIMITS.requestBytes} bytes`),
})

/** A proxy error: marked, so the page can tell it from the site's own answers. */
function proxyError(status: number, message: string, allow?: string): Response {
  return error(status, message, { allow, headers: { [PROXY_ERROR_HEADER]: 'true' } })
}

const rowLimit = bodyLimit({ maxSize: MAX_ROW_REQUEST_BYTES, onError: () => error(413, `Rows are sent in at most ${MAX_ROW_REQUEST_BYTES} bytes`) })

/** Runs a rows route, sending its `RowsError` (or a store's limit) as the error answer. */
async function rowsAnswer(route: () => Promise<Response>): Promise<Response> {
  try {
    return await route()
  } catch (e) {
    const answer = e instanceof RowLimitError ? limitError(e) : e
    if (answer instanceof RowsError) return error(answer.status, answer.message, answer.problems ? { problems: answer.problems } : {})
    throw e
  }
}

const MAX_CACHED_MODELS = 50

/**
 * What `compute` makes of a model revision (the proxy's allowed origins, its Database tables), remembered so a page's
 * requests don't regenerate the model every time. One cache per app: another app's store may hold a different model
 * under the same id and revision (tests' stores do).
 */
function revisionCache<T>(compute: (model: AppModel) => T): ((id: string, revision: number, model: AppModel) => T) & { forget(id: string): void } {
  const cache = new Map<string, T>()
  const get = (id: string, revision: number, model: AppModel) => {
    const key = JSON.stringify([id, revision])
    if (cache.has(key)) return cache.get(key)!
    const value = compute(model)
    if (cache.size >= MAX_CACHED_MODELS) cache.delete(cache.keys().next().value!)
    cache.set(key, value)
    return value
  }
  /** Drops what is cached for a model, e.g. once it is deleted (a model stored again under its id restarts at revision 1). */
  const forget = (id: string) => {
    for (const key of cache.keys()) if ((JSON.parse(key) as [string, number])[0] === id) cache.delete(key)
  }
  return Object.assign(get, { forget })
}

const notFound = () => error(404, 'No model with this id')

interface ErrorOptions {
  problems?: string[]
  /** The methods a path supports (a 405's Allow header). */
  allow?: string
  headers?: Record<string, string>
}

function error(status: number, message: string, { problems, allow, headers = {} }: ErrorOptions = {}): Response {
  return Response.json(problems ? { error: message, problems } : { error: message }, { status, headers: allow ? { ...headers, Allow: allow } : headers })
}

const etag = (revision: number) => `"${revision}"`

/**
 * The revision an If-Match header names: undefined for `*` (any stored revision), null when it is not one tag this API
 * could have sent. A weak tag (`W/"3"`) counts as the revision it names: this API only sends strong ones, so a weak
 * one was weakened on the way (Cloudflare's edge does that when it compresses a response).
 */
function matchRevision(header: string): number | undefined | null {
  const value = header.trim()
  if (value === '*') return undefined
  // At most 15 digits, so Number() reads it exactly.
  const match = /^(?:W\/)?"([1-9][0-9]{0,14})"$/.exec(value)
  return match ? Number(match[1]) : null
}

/** Whether an If-None-Match header names this revision (weak comparison: `W/"3"` matches too) or is `*`. */
function noneMatch(header: string | undefined, revision: number): boolean {
  if (header === undefined) return false
  return header.split(',').some((tag) => {
    const value = tag.trim()
    return value === '*' || value.replace(/^W\//, '') === etag(revision)
  })
}
