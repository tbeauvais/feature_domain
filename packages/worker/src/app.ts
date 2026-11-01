import {
  databaseTableKeys,
  databaseTables,
  featureName,
  generate,
  ModelConflictError,
  ModelNotFoundError,
  newModel,
  signInOf as signInSettings,
  slugProblem,
  validateModel,
  type AppModel,
  type RowStore,
  type ServerModelStore,
} from '@feature-domain/engine'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { createAppHost } from './appHost'
import { CloudflareMailer, DevMailer, type Mailer } from './auth/mailer'
import { appSignIn } from './auth/route'
import { D1AuthTables, type AuthTables } from './auth/store'
import { AlreadyPublishedError, ClaimLostError, SlugTakenError, type AppStore } from './apps'
import { D1AppStore } from './d1AppStore'
import { D1ModelStore, toJson } from './d1ModelStore'
import { D1RowStore } from './d1RowStore'
import type { Env } from './env'
import { HOME_ID, homeModel } from './home'
import { appUrl, hostsOf, siteOf, type Hosts } from './hosts'
import { error, etag, matchRevision, mountApi, noneMatch, sendsJson, versionCache, withPageHeaders } from './http'
import { MODELS_API_SPEC } from './openapi'
import { allowedOrigins, answerProxy, proxyError, proxyLimit, ProxyError } from './proxy'
import { mountRows, RowsError } from './rows'

export { API_HEADERS } from './http'

/**
 * The largest model the API accepts: bytes of the request body, and of the row D1ModelStore stores (the JSON plus the
 * name, which has a column of its own). D1 rows hold at most 2,000,000 bytes on Cloudflare (local D1 doesn't check),
 * and a model can carry an API spec of up to 1 MB (the engine's MAX_SPEC_CHARS) plus sample rows.
 */
export const MAX_MODEL_BYTES = 1_900_000

type AppEnv = { Bindings: Env; Variables: { store: ServerModelStore } }

/** What the Worker runs on; each defaults to its D1 store on the DB binding, the real fetch and the Worker's vars. */
export interface AppOptions {
  store?: (env: Env) => ServerModelStore
  /** The fetch the proxy sends requests to other sites with (tests). */
  upstream?: typeof fetch
  rows?: (env: Env) => RowStore
  apps?: (env: Env) => AppStore
  /** The builder's host and the apps' domain, else the BUILDER_HOST and APP_DOMAIN vars. */
  hosts?: Hosts
  /** Published apps' sign-in tables (src/auth/store.ts). */
  authTables?: (env: Env) => AuthTables
  /** Sends sign-in codes (tests); else Cloudflare Email Sending on the EMAIL binding, from MAIL_FROM. */
  mailer?: (env: Env) => Mailer | undefined
}

/**
 * The Worker. A request is for the builder (its host is BUILDER_HOST), a published app (<slug>.<APP_DOMAIN>), or
 * nothing (404): each site is an app of its own, so nothing of the builder answers on an app's host.
 *
 * The builder serves the editor (static assets) and its API under /api. Every response under /api is JSON; errors are
 * `{ error, problems? }`. A model's revision is its ETag (`"3"`). GET answers `If-None-Match` with a 304 when the model
 * is unchanged, so checking for changes is cheap. PUT with `If-Match` saves only over that revision (else 412, with the
 * stored revision as the ETag); PUT without it overwrites. POST /proxy fetches an address for a page (src/proxy.ts).
 * /models/:id/tables/:table/rows reads and writes a Database table's draft rows (src/rows.ts). /models/:id/publish
 * publishes the model as an app, and /models/:id/publication says where (src/apps.ts). A published app's site is
 * src/appHost.ts.
 */
export function createApp(options: AppOptions = {}) {
  const upstream = options.upstream ?? ((...args) => fetch(...args))
  const rowStoreOf = (env: Env) => (options.rows ? options.rows(env) : new D1RowStore(env.DB))
  const appStoreOf = (env: Env) => (options.apps ? options.apps(env) : new D1AppStore(env.DB))
  const hostsFor = (env: Env | undefined) => options.hosts ?? hostsOf(env)
  const authTablesOf = (env: Env) => (options.authTables ? options.authTables(env) : new D1AuthTables(env.DB))
  // In development, codes go to the log (and the end-to-end tests read them), never out.
  const devMailer = new DevMailer()
  const mailerOf =
    options.mailer ??
    ((env: Env) => (hostsFor(env).apps === 'localhost' ? devMailer : env?.EMAIL && env.MAIL_FROM ? new CloudflareMailer(env.EMAIL, env.MAIL_FROM) : undefined))
  const signInOf = versionCache(appSignIn)
  const originsOf = versionCache(allowedOrigins)
  const tablesOf = versionCache((model) => databaseTables(model))
  const builder = createBuilder()
  const appHost = createAppHost({
    apps: appStoreOf,
    rows: rowStoreOf,
    hosts: hostsFor,
    upstream,
    tablesOf,
    originsOf,
    signInOf,
    authTables: authTablesOf,
    mailer: mailerOf,
    devMail: options.mailer ? undefined : devMailer,
  })

  function createBuilder() {
    const app = new Hono<AppEnv>()
    const api = new Hono<AppEnv>()
    const rowStore = (c: Context<AppEnv>) => rowStoreOf(c.env)
    // A Database table removed by a save takes its draft rows with it, so a table added later under the same instance
    // id (the engine numbers new features after the highest id) starts empty. The save has landed by then, so a failure
    // here is only logged (the next save tries again): answering it as an error would make the editor retry an old
    // revision.
    const forgetRemovedTables = async (c: Context<AppEnv>, id: string, model: AppModel) => {
      try {
        await rowStore(c).keepTables(id, 'draft', databaseTableKeys(model))
      } catch (e) {
        console.error(e)
      }
    }

    api.use(async (c, next) => {
      c.set('store', options.store ? options.store(c.env) : new D1ModelStore(c.env.DB))
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
      if (noneMatch(c.req.header('If-None-Match'), etag(stored.revision))) return c.body(null, 304, headers)
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

    // Its rows, app, versions and sign-in tables go with it.
    api.delete('/models/:id', async (c) => {
      const id = c.req.param('id')
      const apps = appStoreOf(c.env)
      // Its app first: should a later step fail, nothing is left serving a model that is gone. And once more at the end,
      // for a publish that stored a version meanwhile (one storing it later finds the model gone and takes it down).
      await apps.deleteModel(id)
      await c.var.store.delete(id)
      await rowStore(c).deleteModel(id)
      await apps.deleteModel(id)
      // A model stored again under this id (the home page's) starts at revision 1 again, so nothing cached for it holds.
      originsOf.forget(id)
      tablesOf.forget(id)
      signInOf.forget(id)
      // Last, and only logged on failure: the model is gone, and nothing serves the tables. db:upgrade-apps drops what's
      // left of a model's tables.
      try {
        await authTablesOf(c.env).drop(id)
      } catch (e) {
        console.error(e)
      }
      return c.body(null, 204)
    })

    api.get('/openapi.json', (c) => c.json(MODELS_API_SPEC))

    // Puts the built-in home page back, over whatever is stored (a broken one) or in place of a deleted one. Only as
    // application/json, like every other request that changes data, so a form on another site can't send it.
    api.post('/home/reset', async (c) => {
      if (!sendsJson(c.req.raw)) return error(415, 'Send the request as application/json')
      const model = homeModel()
      const revision = await c.var.store.put(HOME_ID, model)
      await forgetRemovedTables(c, HOME_ID, model)
      return c.body(null, 204, { ETag: etag(revision) })
    })

    api.post('/proxy', proxyLimit, (c) => {
      const site = { self: new URL(c.req.url).hostname, hosts: hostsFor(c.env) }
      return answerProxy(
        c.req.raw,
        true,
        async ({ model }) => {
          const stored = await c.var.store.get(model!)
          if (!stored) throw new ProxyError(404, 'No model with this id')
          return originsOf(model!, `draft:${stored.revision}`, stored.model)
        },
        site,
        upstream,
      )
    })

    // A Database table's rows: the draft's, read and written by the editor's canvas and the preview.
    mountRows(
      api,
      '/models/:id/tables/:table/rows',
      async (c: Context<AppEnv>) => {
        const id = c.req.param('id')!
        const stored = await c.var.store.get(id)
        if (!stored) throw new RowsError(404, 'No model with this id')
        return {
          rowStore: rowStore(c),
          ref: { model: id, space: 'draft', table: c.req.param('table')! },
          tables: tablesOf(id, `draft:${stored.revision}`, stored.model),
        }
      },
      (ref, row) => `/api/v1/models/${encodeURIComponent(ref.model)}/tables/${ref.table}/rows/${row}`,
    )

    // Publishing: the stored draft becomes the app's next version, at <slug>.<app domain>.
    api.post('/models/:id/publish', publishLimit, async (c) => {
      const id = c.req.param('id')
      if (id === HOME_ID) return error(400, "The home page is part of the builder, so it can't be published")
      if (!sendsJson(c.req.raw)) return error(415, 'Send the request as application/json')
      // The editor saves first, then publishes the revision it shows: a draft changed since (elsewhere) isn't published.
      const ifMatch = c.req.header('If-Match')
      const ifRevision = ifMatch === undefined ? undefined : matchRevision(ifMatch)
      if (ifRevision === null) return error(400, 'If-Match must be one revision, as the ETag gave it')
      if (ifRevision === undefined) return error(428, 'Name the revision to publish in If-Match, as the ETag gave it')
      const body = await readPublish(c.req.raw)
      if (body instanceof Response) return body
      return withClaim(c, id, (claim) => publish(c, id, ifRevision, body, claim))
    })

    /**
     * Runs `act` holding the model's publishing claim, so one request at a time publishes or unpublishes a model: a
     * publish reads the app's versions and live rows, then changes them, and must not act on what another is changing.
     */
    const withClaim = async (c: Context<AppEnv>, id: string, act: (claim: string) => Promise<Response>): Promise<Response> => {
      const apps = appStoreOf(c.env)
      const claim = await apps.claim(id)
      if (claim === null) return beingChanged()
      try {
        return await act(claim)
      } finally {
        // What the request did is its answer; a claim not released only holds until it is too old.
        await apps.release(id, claim).catch((e: unknown) => console.error(e))
      }
    }

    /** A publish of the draft, once the request holds the model's claim. */
    const publish = async (c: Context<AppEnv>, id: string, ifRevision: number, body: PublishRequest, claim: string): Promise<Response> => {
      const stored = await c.var.store.get(id)
      if (!stored) return notFound()
      if (stored.revision !== ifRevision) return error(412, 'The model was changed since this revision', { headers: { ETag: etag(stored.revision) } })
      return release(c, id, stored.model, body, claim)
    }

    /**
     * Makes `app` (the draft, or an earlier version published again) the app's next version: the address, the tables it
     * removes (each confirmed), the live rows of a first publish, and afterwards the removed tables' rows.
     */
    const release = async (c: Context<AppEnv>, id: string, app: AppModel, body: PublishRequest, claim: string): Promise<Response> => {
      // Generated as the engine does now: an earlier version that no longer generates cleanly isn't published either.
      const generated = generate(app)
      const problems = generated.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)
      if (problems.length > 0) return error(400, 'The model has problems to fix before it can be published', { problems })
      const apps = appStoreOf(c.env)
      const rows = rowStoreOf(c.env)
      const [current, latest] = await Promise.all([apps.publication(id), apps.latest(id)])
      const slug = body.slug ?? current?.slug
      if (slug === undefined) return error(400, 'Choose the address to publish at', { problems: ['Give the app an address name'] })
      const wrong = slugProblem(slug)
      if (wrong) return error(400, 'The address name is not valid', { problems: [wrong] })

      // Tables of the app the new version no longer holds lose their live rows (`keepTables` below): the newest
      // version's, and any other the app still keeps rows in. Only when the request names each one.
      const kept = new Set(databaseTableKeys(app))
      const live = latest
        ? new Set([...tablesOf(id, `live:${latest.number}`, latest.model).keys(), ...Object.keys(await rows.countRows(id, 'live'))])
        : new Set<string>()
      const unconfirmed = [...live].filter((key) => !kept.has(key) && !body.removeTables.includes(key))
      if (unconfirmed.length > 0)
        return error(409, 'Publishing removes tables and the rows the app keeps in them', {
          problems: unconfirmed.map((key) => `Confirm removing "${tableName(latest!.model, key)}" (${key}) and its rows`),
        })

      if (body.copyDraftRows && latest) return error(400, "The draft's rows are copied only when a model is first published")

      // A first publish starts the app's rows afresh before the app is served, so no visitor's row is lost to it: a copy
      // of the draft's, or none (each table then starts with its sample rows), whatever an earlier try left there.
      const first = !latest
      if (first) await (body.copyDraftRows ? rows.copySpace(id, 'draft', 'live') : rows.keepTables(id, 'live', []))
      // An app with sign-in gets its auth tables before it is served: created, or brought up to date. Never dropped here
      // (an earlier version without sign-in published again keeps them, and its accounts, for a later one with it).
      if (signInSettings(generated)) await authTablesOf(c.env).ensure(id)
      let publication
      try {
        // Only while the claim holds: one taken over (a publish past PUBLISHING_CLAIM_MS) stores nothing.
        publication = await apps.publish(id, slug, app, { first, claim })
      } catch (e) {
        // Its auth tables may have been made for a model deleted meanwhile: nothing will serve them.
        if (!(await c.var.store.get(id))) await authTablesOf(c.env).drop(id)
        if (e instanceof SlugTakenError) return error(409, 'Another app has this address', { problems: [`"${slug}" is taken: choose another address name`] })
        if (e instanceof AlreadyPublishedError)
          return error(409, 'The model was published meanwhile', { problems: ['Look at its publication again before publishing'] })
        if (e instanceof ClaimLostError) return beingChanged()
        throw e
      }
      // Deleted meanwhile (deleting doesn't wait for a publish): nothing may serve it.
      if (!(await c.var.store.get(id))) {
        await apps.deleteModel(id)
        await rows.deleteModel(id)
        await authTablesOf(c.env).drop(id)
        return notFound()
      }
      // The new version is live, so the removed tables' rows can go (a table added later under the same id starts
      // empty). Like a save's, a failure is only logged: the next publish tries again.
      if (!first) {
        try {
          await rows.keepTables(id, 'live', [...kept])
        } catch (e) {
          console.error(e)
        }
      }
      return c.json(publicationJson(publication, c.req.url, hostsFor(c.env)))
    }

    // The model's versions, newest first, for the Publish dialog's list (their models only one at a time, below).
    api.get('/models/:id/versions', async (c) => {
      const id = c.req.param('id')
      if (!(await c.var.store.get(id))) return notFound()
      const versions = await appStoreOf(c.env).versions(id)
      return c.json(
        versions.map((v) => ({ version: v.number, published_at: v.publishedAt, name: v.name })),
        200,
        { 'Cache-Control': 'no-store' },
      )
    })

    // One version as it was published (versions never change).
    api.get('/models/:id/versions/:version', async (c) => {
      const id = c.req.param('id')
      const number = versionNumber(c.req.param('version'))
      const stored = number === undefined ? null : await appStoreOf(c.env).version(id, number)
      if (!stored) return error(404, 'No such version of this model')
      return c.json({ version: stored.number, published_at: stored.publishedAt, model: stored.model }, 200, { 'Cache-Control': 'no-store' })
    })

    // Rolling back: an earlier version published again, as the app's next version (versions never change). The draft
    // stays as it is.
    api.post('/models/:id/versions/:version/publish', publishLimit, async (c) => {
      const id = c.req.param('id')
      if (!sendsJson(c.req.raw)) return error(415, 'Send the request as application/json')
      const number = versionNumber(c.req.param('version'))
      if (number === undefined) return error(404, 'No such version of this model')
      const body = await readPublish(c.req.raw)
      if (body instanceof Response) return body
      if (body.copyDraftRows) return error(400, "The draft's rows are copied only when a model is first published")
      return withClaim(c, id, async (claim) => {
        if (!(await c.var.store.get(id))) return notFound()
        const stored = await appStoreOf(c.env).version(id, number)
        if (!stored) return error(404, 'No such version of this model')
        return release(c, id, stored.model, body, claim)
      })
    })

    // Where the model is published (null when it isn't), where it would be, its newest version (the one a publish is
    // compared with) and how many rows the app keeps in each table a publish could remove, for the Publish dialog.
    api.get('/models/:id/publication', async (c) => {
      const id = c.req.param('id')
      if (!(await c.var.store.get(id))) return notFound()
      const apps = appStoreOf(c.env)
      const [current, latest] = await Promise.all([apps.publication(id), apps.latest(id)])
      // Every table a publish asks about removing (as `publish` works it out): the newest version's, and any other the
      // app still keeps rows in.
      const counts: Record<string, number> = {}
      if (latest) {
        const stored = await rowStoreOf(c.env).countRows(id, 'live')
        for (const key of tablesOf(id, `live:${latest.number}`, latest.model).keys()) counts[key] = stored[key] ?? 0
        for (const [key, count] of Object.entries(stored)) counts[key] = count
      }
      return c.json(
        {
          published: current ? publicationJson(current, c.req.url, hostsFor(c.env)) : null,
          // Where an address name would put the app, `{slug}` standing for it, for the dialog to show before publishing.
          url_template: appUrl('{slug}', c.req.url, hostsFor(c.env)),
          latest: latest ? { version: latest.number, published_at: latest.publishedAt, model: latest.model } : null,
          live_rows: counts,
        },
        200,
        { 'Cache-Control': 'no-store' },
      )
    })

    // Takes the app offline and frees its address; its versions and rows stay for when it is published again.
    api.delete('/models/:id/publication', async (c) => {
      const id = c.req.param('id')
      if (!(await c.var.store.get(id))) return notFound()
      return withClaim(c, id, async () => {
        await appStoreOf(c.env).unpublish(id)
        return c.body(null, 204)
      })
    })

    api.all('/models', () => error(405, 'Method not allowed', { allow: 'GET, POST' }))
    api.all('/models/:id', () => error(405, 'Method not allowed', { allow: 'GET, PUT, DELETE' }))
    api.all('/models/:id/publish', () => error(405, 'Method not allowed', { allow: 'POST' }))
    api.all('/models/:id/publication', () => error(405, 'Method not allowed', { allow: 'GET, DELETE' }))
    api.all('/models/:id/versions', () => error(405, 'Method not allowed', { allow: 'GET' }))
    api.all('/models/:id/versions/:version', () => error(405, 'Method not allowed', { allow: 'GET' }))
    api.all('/models/:id/versions/:version/publish', () => error(405, 'Method not allowed', { allow: 'POST' }))
    api.all('/proxy', () => proxyError(405, 'Method not allowed', 'POST'))
    api.all('/openapi.json', () => error(405, 'Method not allowed', { allow: 'GET' }))
    api.all('/home/reset', () => error(405, 'Method not allowed', { allow: 'POST' }))

    mountApi(app, api)
    // Everything else is the editor's static assets (unknown paths get index.html: its routes are client-side).
    app.all('*', async (c) => (c.env?.ASSETS ? withPageHeaders(await c.env.ASSETS.fetch(c.req.raw)) : c.notFound()))
    return app
  }

  const serve = (request: Request, env?: Env, ctx?: ExecutionContext): Response | Promise<Response> => {
    const site = siteOf(new URL(request.url).hostname, hostsFor(env))
    if (site.kind === 'builder') return builder.fetch(request, env, ctx)
    if (site.kind === 'app') return appHost.fetch(request, env, ctx)
    return withPageHeaders(new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }))
  }
  /** As Hono's `request`: a path is on http://localhost (the builder in development and tests). */
  const request = (input: string | URL | Request, init?: RequestInit, env?: Env) =>
    serve(new Request(typeof input === 'string' && input.startsWith('/') ? `http://localhost${input}` : input, init), env)
  return { fetch: serve, request }
}

/** What a publish request asks for: the address (else the app's current one), and what it confirms. */
interface PublishRequest {
  slug?: string
  copyDraftRows: boolean
  removeTables: string[]
}

async function readPublish(request: Request): Promise<PublishRequest | Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return error(400, 'The body is not valid JSON')
  }
  const bad = (problem: string) => error(400, 'The request is not valid', { problems: [problem] })
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return bad('Send { slug?, copyDraftRows?, removeTables? }')
  const { slug, copyDraftRows = false, removeTables = [] } = body as Record<string, unknown>
  if (slug !== undefined && typeof slug !== 'string') return bad('slug must be text')
  if (typeof copyDraftRows !== 'boolean') return bad('copyDraftRows must be true or false')
  if (!Array.isArray(removeTables) || !removeTables.every((key) => typeof key === 'string')) return bad('removeTables must be a list of table ids')
  return slug === undefined ? { copyDraftRows, removeTables } : { slug, copyDraftRows, removeTables }
}

/** A version number as a path names it (`3`), or undefined for anything else. */
function versionNumber(text: string | undefined): number | undefined {
  return text !== undefined && /^[1-9][0-9]{0,8}$/.test(text) ? Number(text) : undefined
}

/** A Database table's name in a model, else its id. */
const tableName = (model: AppModel, key: string) => featureName(model, key) ?? key

const publicationJson = (p: { slug: string; version: number; publishedAt: string }, requestUrl: string, hosts: Hosts) => ({
  slug: p.slug,
  url: appUrl(p.slug, requestUrl, hosts),
  version: p.version,
  published_at: p.publishedAt,
})

const tooLarge = () => error(413, `Models are limited to ${MAX_MODEL_BYTES} bytes`)
const limit = bodyLimit({ maxSize: MAX_MODEL_BYTES, onError: tooLarge })
const bytes = (value: string) => new TextEncoder().encode(value).length

/**
 * The request's model, or the error response to send instead. With `named`, a body that is only `{ name }` (what a
 * form sends) starts a new model with one empty page.
 */
async function readModel(request: Request, named = false): Promise<AppModel | Response> {
  if (!sendsJson(request)) return error(415, 'Send the model as application/json')
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

/** Publish requests hold an address and a list of table ids: small. */
const PUBLISH_REQUEST_BYTES = 16_384
const publishLimit = bodyLimit({ maxSize: PUBLISH_REQUEST_BYTES, onError: () => error(413, `Publish requests are limited to ${PUBLISH_REQUEST_BYTES} bytes`) })

const notFound = () => error(404, 'No model with this id')
/** Another request is publishing or unpublishing the model (it holds the claim). */
const beingChanged = () => error(409, "The model's app is being changed", { problems: ['Try again in a moment'] })
