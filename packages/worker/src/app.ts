import { ModelConflictError, ModelNotFoundError, validateModel, type AppModel, type ModelStore } from '@feature-domain/engine'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { D1ModelStore, toJson } from './d1ModelStore'
import type { Env } from './env'

/**
 * The largest model the API accepts: bytes of the request body, and of the row D1ModelStore stores (the JSON plus the
 * name, which has a column of its own). D1 rows hold at most 2,000,000 bytes on Cloudflare (local D1 doesn't check),
 * and a model can carry an API spec of up to 1 MB (the engine's MAX_SPEC_CHARS) plus sample rows.
 */
export const MAX_MODEL_BYTES = 1_900_000

type AppEnv = { Bindings: Env; Variables: { store: ModelStore } }

/**
 * The Worker's HTTP API. Every response under /api is JSON; errors are `{ error, problems? }`. `store` replaces the D1
 * store (tests); by default each request uses the DB binding.
 *
 * A model's version is its ETag (`"3"`). GET answers `If-None-Match` with a 304 when the model is unchanged, so
 * checking for changes is cheap. PUT with `If-Match` saves only over that version (else 412, with the stored version as
 * the ETag); PUT without it overwrites.
 */
export function createApp(store?: (env: Env) => ModelStore) {
  const app = new Hono<AppEnv>()
  const api = new Hono<AppEnv>()

  api.use(async (c, next) => {
    c.set('store', store ? store(c.env) : new D1ModelStore(c.env.DB))
    await next()
  })

  api.get('/models', async (c) => c.json(await c.var.store.list(), 200, { 'Cache-Control': 'no-cache' }))

  api.post('/models', limit, async (c) => {
    const model = await readModel(c.req.raw)
    if (model instanceof Response) return model
    const id = await c.var.store.create(model)
    return c.json({ id }, 201, { Location: `/api/v1/models/${encodeURIComponent(id)}`, ETag: etag(1) })
  })

  api.get('/models/:id', async (c) => {
    const stored = await c.var.store.get(c.req.param('id'))
    if (!stored) return notFound()
    const headers = { ETag: etag(stored.version), 'Cache-Control': 'no-cache' }
    if (noneMatch(c.req.header('If-None-Match'), stored.version)) return c.body(null, 304, headers)
    return c.json(stored.model, 200, headers)
  })

  api.put('/models/:id', limit, async (c) => {
    const ifMatch = c.req.header('If-Match')
    const ifVersion = ifMatch === undefined ? undefined : matchVersion(ifMatch)
    if (ifVersion === null) return error(400, 'If-Match must be "*" or one version, as the ETag gave it')
    const model = await readModel(c.req.raw)
    if (model instanceof Response) return model
    let version: number
    try {
      version = await c.var.store.update(c.req.param('id'), model, ifVersion)
    } catch (e) {
      if (e instanceof ModelNotFoundError) return notFound()
      if (e instanceof ModelConflictError) {
        return error(412, 'The model was changed since this version', undefined, undefined, { ETag: etag(e.version) })
      }
      throw e
    }
    return c.body(null, 204, { ETag: etag(version) })
  })

  api.delete('/models/:id', async (c) => {
    await c.var.store.delete(c.req.param('id'))
    return c.body(null, 204)
  })

  api.all('/models', () => error(405, 'Method not allowed', undefined, 'GET, POST'))
  api.all('/models/:id', () => error(405, 'Method not allowed', undefined, 'GET, PUT, DELETE'))

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

/** The request's model, or the error response to send instead. */
async function readModel(request: Request): Promise<AppModel | Response> {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    return error(415, 'Send the model as application/json')
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return error(400, 'The body is not valid JSON')
  }
  const problems = validateModel(body)
  if (problems.length > 0) return error(400, 'The model is not valid', problems)
  const model = body as AppModel
  return bytes(toJson(model)) + bytes(model.name) > MAX_MODEL_BYTES ? tooLarge() : model
}

const notFound = () => error(404, 'No model with this id')

function error(status: number, message: string, problems?: string[], allow?: string, headers: Record<string, string> = {}): Response {
  return Response.json(problems ? { error: message, problems } : { error: message }, { status, headers: allow ? { ...headers, Allow: allow } : headers })
}

const etag = (version: number) => `"${version}"`

/**
 * The version an If-Match header names: undefined for `*` (any stored version), null when it is not one strong tag
 * this API could have sent (weak tags never match an If-Match).
 */
function matchVersion(header: string): number | undefined | null {
  const value = header.trim()
  if (value === '*') return undefined
  const match = /^"([1-9][0-9]{0,15})"$/.exec(value)
  return match ? Number(match[1]) : null
}

/** Whether an If-None-Match header names this version (weak comparison: `W/"3"` matches too) or is `*`. */
function noneMatch(header: string | undefined, version: number): boolean {
  if (header === undefined) return false
  return header.split(',').some((tag) => {
    const value = tag.trim()
    return value === '*' || value.replace(/^W\//, '') === etag(version)
  })
}
