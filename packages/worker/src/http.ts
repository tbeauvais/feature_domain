// What the builder's API and the published apps' API share: JSON errors, ETags, and caches per model version.

import type { AppModel } from '@feature-domain/engine'
import type { Hono } from 'hono'
import type {} from './env'

/** Security headers on every /api response, errors included. */
export const API_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}

/**
 * Security headers on every page and file the Worker passes on from the assets: the same as packages/web/public/_headers
 * (a test checks they match). Cloudflare applies that file only to assets it serves itself, not to answers from Worker
 * code, and with run_worker_first the Worker answers everything.
 */
export const PAGE_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: https:; connect-src 'self' https:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
}

/**
 * The page headers to set. On Vite's development server (`import.meta.hot`, which every build leaves undefined, whatever
 * its mode) pages carry inline styles and scripts the CSP refuses, so there they get none, as before the Worker ran first.
 */
export function pageHeaders(devServer = import.meta.hot !== undefined): Record<string, string> {
  if (!devServer) return PAGE_HEADERS
  const { 'Content-Security-Policy': _csp, ...others } = PAGE_HEADERS
  return others
}

/** An answer from the assets (or a page of the Worker's own) with `pageHeaders()` set, whatever it carried. */
export function withPageHeaders(response: Response, status = response.status): Response {
  const out = new Response(response.body, { status, statusText: status === response.status ? response.statusText : '', headers: response.headers })
  for (const [name, value] of Object.entries(pageHeaders())) out.headers.set(name, value)
  return out
}

export interface ErrorOptions {
  problems?: string[]
  /** The methods a path supports (a 405's Allow header). */
  allow?: string
  headers?: Record<string, string>
}

export function error(status: number, message: string, { problems, allow, headers = {} }: ErrorOptions = {}): Response {
  return Response.json(problems ? { error: message, problems } : { error: message }, { status, headers: allow ? { ...headers, Allow: allow } : headers })
}

/** Whether a request says its body is JSON: every request that changes data must, so a form on another site can't send one. */
export const sendsJson = (request: Request) => request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json') ?? false

export const etag = (revision: number) => `"${revision}"`

/**
 * The revision an If-Match header names: undefined for `*` (any stored revision), null when it is not one tag this API
 * could have sent. A weak tag (`W/"3"`) counts as the revision it names: this API only sends strong ones, so a weak
 * one was weakened on the way (Cloudflare's edge does that when it compresses a response).
 */
export function matchRevision(header: string): number | undefined | null {
  const value = header.trim()
  if (value === '*') return undefined
  // At most 15 digits, so Number() reads it exactly.
  const match = /^(?:W\/)?"([1-9][0-9]{0,14})"$/.exec(value)
  return match ? Number(match[1]) : null
}

/** Whether an If-None-Match header names this ETag (weak comparison: `W/"3"` matches `"3"` too) or is `*`. */
export function noneMatch(header: string | undefined, tag: string): boolean {
  if (header === undefined) return false
  return header.split(',').some((value) => {
    const named = value.trim()
    return named === '*' || named.replace(/^W\//, '') === tag
  })
}

const MAX_CACHED_MODELS = 50

/** What a model version is cached under: its draft's revision, or a published version (`live`). */
export type VersionTag = `draft:${number}` | `live:${number}`

/**
 * What `compute` makes of a model version (the proxy's allowed origins, its Database tables), remembered so a page's
 * requests don't regenerate the model every time. The draft and the published app are cached apart: a draft revision
 * and a version can have the same number. One cache per app: another app's store may hold a different model under the
 * same id and revision (tests' stores do).
 */
export function versionCache<T>(compute: (model: AppModel) => T): ((id: string, tag: VersionTag, model: AppModel) => T) & {
  load(id: string, tag: VersionTag, model: () => Promise<AppModel>): Promise<T>
  forget(id: string): void
} {
  const cache = new Map<string, T>()
  const get = (id: string, tag: VersionTag, model: AppModel) => {
    const key = JSON.stringify([id, tag])
    if (cache.has(key)) return cache.get(key)!
    const value = compute(model)
    if (cache.size >= MAX_CACHED_MODELS) cache.delete(cache.keys().next().value!)
    cache.set(key, value)
    return value
  }
  /** As `get`, reading the model only when nothing is cached for it (a published version is read from the store). */
  const load = async (id: string, tag: VersionTag, model: () => Promise<AppModel>) => {
    const key = JSON.stringify([id, tag])
    return cache.has(key) ? cache.get(key)! : get(id, tag, await model())
  }
  /** Drops what is cached for a model, e.g. once it is deleted (a model stored again under its id restarts at revision 1). */
  const forget = (id: string) => {
    for (const key of cache.keys()) if ((JSON.parse(key) as [string, string])[0] === id) cache.delete(key)
  }
  return Object.assign(get, { load, forget })
}

/**
 * Mounts a site's API at /api/v1 with what every site's API shares: `API_HEADERS` on every /api answer, errors
 * included (answers are data, never pages: nothing in them may run, load or be framed), a JSON 404 for any other /api
 * path, and a 500 that reveals nothing. Routes the site adds afterwards (its pages) never see /api requests.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each site's Hono app has its own environment type
export function mountApi<A extends Hono<any>>(app: A, api: A): void {
  app.use('/api/*', async (c, next) => {
    try {
      await next()
    } finally {
      for (const [name, value] of Object.entries(API_HEADERS)) c.res.headers.set(name, value)
    }
  })
  app.route('/api/v1', api)
  app.all('/api/*', () => error(404, 'No such API endpoint'))
  // An error thrown before the header middleware above runs (a site's own middleware) gets the headers here.
  app.onError((err, c) => {
    console.error(err)
    const answer = error(500, 'Something went wrong on the server')
    const headers = new URL(c.req.url).pathname.startsWith('/api/') ? API_HEADERS : pageHeaders()
    for (const [name, value] of Object.entries(headers)) answer.headers.set(name, value)
    return answer
  })
}
