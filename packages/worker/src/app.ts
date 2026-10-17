import { ModelNotFoundError, validateModel, type AppModel, type ModelStore } from '@feature-domain/engine'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { D1ModelStore } from './d1ModelStore'
import type { Env } from './env'

/**
 * The largest model the API accepts, in bytes of JSON. D1 rows hold at most 2,000,000 bytes, and a model can carry an
 * API spec of up to 1 MB (the engine's MAX_SPEC_CHARS) plus sample rows.
 */
export const MAX_MODEL_BYTES = 1_900_000

type AppEnv = { Bindings: Env; Variables: { store: ModelStore } }

/**
 * The Worker's HTTP API. Every response under /api is JSON; errors are `{ error, problems? }`. `store` replaces the D1
 * store (tests); by default each request uses the DB binding.
 */
export function createApp(store?: (env: Env) => ModelStore) {
  const app = new Hono<AppEnv>()
  const api = new Hono<AppEnv>()

  api.use(async (c, next) => {
    c.set('store', store ? store(c.env) : new D1ModelStore(c.env.DB))
    await next()
  })

  api.get('/models', async (c) => c.json(await c.var.store.list()))

  api.post('/models', limit, async (c) => {
    const model = await readModel(c.req.raw)
    if (model instanceof Response) return model
    const id = await c.var.store.create(model)
    return c.json({ id }, 201, { Location: `/api/v1/models/${encodeURIComponent(id)}` })
  })

  api.get('/models/:id', async (c) => {
    const model = await c.var.store.get(c.req.param('id'))
    return model ? c.json(model) : notFound()
  })

  api.put('/models/:id', limit, async (c) => {
    const model = await readModel(c.req.raw)
    if (model instanceof Response) return model
    try {
      await c.var.store.update(c.req.param('id'), model)
    } catch (error) {
      if (error instanceof ModelNotFoundError) return notFound()
      throw error
    }
    return c.body(null, 204)
  })

  api.delete('/models/:id', async (c) => {
    await c.var.store.delete(c.req.param('id'))
    return c.body(null, 204)
  })

  app.route('/api/v1', api)
  app.all('/api/*', () => error(404, 'No such API endpoint'))
  app.onError((err) => {
    console.error(err)
    return error(500, 'Something went wrong on the server')
  })
  return app
}

const limit = bodyLimit({ maxSize: MAX_MODEL_BYTES, onError: () => error(413, `Models are limited to ${MAX_MODEL_BYTES} bytes`) })

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
  return problems.length > 0 ? error(400, 'The model is not valid', problems) : (body as AppModel)
}

const notFound = () => error(404, 'No model with this id')

function error(status: number, message: string, problems?: string[]): Response {
  return Response.json(problems ? { error: message, problems } : { error: message }, { status })
}
