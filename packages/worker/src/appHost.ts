// A published app's site, at <slug>.<app domain>: its page (app.html, whatever the path), and its API under
// /api/v1/app: the published version, its live rows and its proxy. Nothing of the builder is reachable here: the model
// is always the one the host names, never one a request names.

import { databaseTables, type AppModel, type RowStore } from '@feature-domain/engine'
import { Hono, type Context } from 'hono'
import type { AppStore } from './apps'
import type { Env } from './env'
import { siteOf, type Hosts } from './hosts'
import { error, mountApi, noneMatch, withPageHeaders, type versionCache } from './http'
import { allowedOrigins, answerProxy, proxyError, proxyLimit, ProxyError } from './proxy'
import { mountRows, RowsError } from './rows'

/** What the app's site uses: its stores, the platform's hosts, and caches per model version. */
export interface AppHostDeps {
  apps: (env: Env) => AppStore
  rows: (env: Env) => RowStore
  hosts: (env: Env | undefined) => Hosts
  upstream: typeof fetch
  tablesOf: ReturnType<typeof versionCache<ReturnType<typeof databaseTables>>>
  originsOf: ReturnType<typeof versionCache<ReturnType<typeof allowedOrigins>>>
}

/** The app a request's host serves: its model and the number of its published version. */
type Published = { model: string; version: number }
const NOTHING_PUBLISHED = 'No app is published at this address'
type AppHostEnv = { Bindings: Env; Variables: { published: Published | undefined } }

export function createAppHost(deps: AppHostDeps) {
  const app = new Hono<AppHostEnv>()
  const api = new Hono<AppHostEnv>()

  /**
   * The published version's model, read from the store each time it is needed: only to answer /api/v1/app, or when
   * its tables or proxy origins aren't cached yet. (Models can be large, so they aren't kept themselves.)
   */
  const modelOf = (c: Context<AppHostEnv>, gone: (message: string) => Error) => async (): Promise<AppModel> => {
    const { model, version } = published(c)
    const stored = await deps.apps(c.env).version(model, version)
    // Deleted since the request began: as if it never was.
    if (!stored) throw gone(NOTHING_PUBLISHED)
    return stored.model
  }

  // The app's scripts, styles and fonts (built, under /assets/; in development, Vite's modules) are the same for every
  // app, so they are served whatever is published here. A file there isn't is a 404, never the editor's page (the
  // assets' single-page fallback).
  // A path a client doesn't say is a file, but that looks like one, is the app's page when no such file exists.
  app.on(['GET', 'HEAD'], '*', async (c, next) => {
    const asked = requestFor(c.req.raw)
    if (asked === 'page') return next()
    if (!c.env?.ASSETS) return c.notFound()
    const response = await c.env.ASSETS.fetch(c.req.raw)
    if (!response.headers.get('Content-Type')?.startsWith('text/html')) return withPageHeaders(response)
    return asked === 'file' ? withPageHeaders(notFoundFile()) : next()
  })

  // Everything else is for the app published here, if any.
  app.use(async (c, next) => {
    const site = siteOf(new URL(c.req.url).hostname, deps.hosts(c.env))
    c.set('published', (site.kind === 'app' && (await deps.apps(c.env).bySlug(site.slug))) || undefined)
    await next()
  })

  api.use(async (c, next) => {
    if (!c.var.published) return error(404, NOTHING_PUBLISHED)
    await next()
  })

  /** The published app, once the middleware above has checked there is one. */
  const published = (c: Context<AppHostEnv>) => c.var.published!

  // The published version: what the app's page shows. Its number is its ETag, so a page checks for a new one cheaply.
  // The model's id is in it too: an address can pass to another model's app, whose version 1 isn't this one's.
  api.get('/app', async (c) => {
    const { model, version } = published(c)
    const headers = { ETag: `"${version}.${encodeURIComponent(model)}"`, 'Cache-Control': 'no-cache' }
    if (noneMatch(c.req.header('If-None-Match'), headers.ETag)) return c.body(null, 304, headers)
    const stored = await deps.apps(c.env).version(model, version)
    // Deleted since the request began: as if it never was.
    return stored ? c.json(stored.model, 200, headers) : error(404, NOTHING_PUBLISHED)
  })

  // The app's own rows (the live space), checked against the published version's Database tables.
  mountRows(
    api,
    '/app/tables/:table/rows',
    async (c: Context<AppHostEnv>) => {
      const { model, version } = published(c)
      return {
        rowStore: deps.rows(c.env),
        ref: { model, space: 'live', table: c.req.param('table')! },
        tables: await deps.tablesOf.load(
          model,
          `live:${version}`,
          modelOf(c, (message) => new RowsError(404, message)),
        ),
      }
    },
    (ref, id) => `/api/v1/app/tables/${ref.table}/rows/${id}`,
  )

  // The proxy, for the published version's Server addresses only.
  api.post('/app/proxy', proxyLimit, (c) => {
    const { model, version } = published(c)
    const site = { self: new URL(c.req.url).hostname, hosts: deps.hosts(c.env) }
    const origins = () =>
      deps.originsOf.load(
        model,
        `live:${version}`,
        modelOf(c, (message) => new ProxyError(404, message)),
      )
    return answerProxy(c.req.raw, false, origins, site, deps.upstream)
  })

  api.all('/app', () => error(405, 'Method not allowed', { allow: 'GET' }))
  api.all('/app/proxy', () => proxyError(405, 'Method not allowed', 'POST'))

  mountApi(app, api)

  // Any other path is the app's page: app.html, which reads /api/v1/app. Where nothing is published it still is (it
  // says so), with a 404.
  app.on(['GET', 'HEAD'], '*', async (c) => {
    if (!c.env?.ASSETS) return c.notFound()
    // Asked for as a page, whatever the request was (Vite treats a module request for an .html file as JavaScript). Where
    // nothing is published, always in full, so a browser revalidating a page it kept gets the 404, not a 304.
    const headers = new Headers({ Accept: 'text/html', 'Sec-Fetch-Dest': 'document' })
    if (c.var.published) for (const name of ['If-None-Match', 'If-Modified-Since']) if (c.req.header(name)) headers.set(name, c.req.header(name)!)
    const page = await c.env.ASSETS.fetch(new Request(new URL('/app.html', c.req.url), { method: c.req.method, headers }))
    return withPageHeaders(page, c.var.published || !page.ok ? page.status : 404)
  })
  app.all('*', () => withPageHeaders(new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })))

  return app
}

/**
 * Whether a request is for one of the app's files or its page. A `file` is what a browser loads into a page (a script,
 * style or font: `Sec-Fetch-Dest` other than a document or a fetch's `empty`), or a path under /assets/. A path whose
 * last part has an extension, from a fetch or a client that doesn't say, `may` be a file: the page when there's none,
 * so every page path shows the app and links within it never 404. The API is neither.
 */
function requestFor(request: Request): 'file' | 'may' | 'page' {
  const path = new URL(request.url).pathname
  if (path.startsWith('/api/')) return 'page'
  const dest = request.headers.get('Sec-Fetch-Dest')
  if (dest && dest !== 'document' && dest !== 'empty') return 'file'
  if (dest === 'document') return 'page'
  if (path.startsWith('/assets/')) return 'file'
  return /\.[A-Za-z0-9]+$/.test(path.slice(path.lastIndexOf('/') + 1)) ? 'may' : 'page'
}

const notFoundFile = () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
