// A published app's sign-in, on its own host: /api/v1/app/auth/* (Better Auth, only the endpoints below) and
// /api/v1/app/account (what the app holds about the person signed in, to download). The app is always the one the
// host names: its tables, its secret, its exact address. Only while the published version has sign-in.

import {
  generate,
  onAllowedList,
  pageTheme,
  signInOf,
  type AppModel,
  type DatabaseTable,
  type OpenTo,
  type RowStore,
  type ThemeTokens,
} from '@feature-domain/engine'
import type { Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { error, sendsJson } from '../http'
import { pageRow } from '../rows'
import { appSecret, AUTH_BASE_PATH, authFor } from './authFor'
import type { Mailer } from './mailer'
import type { AppAuth, AuthTables } from './store'
import { AUTH_SCHEMA_STEPS } from './tables'

/** The Better Auth endpoints an app answers, and their methods. Anything else is a 404, so nothing else is reachable. */
export const AUTH_ENDPOINTS: Readonly<Record<string, readonly string[]>> = {
  '/get-session': ['GET'],
  '/sign-out': ['POST'],
  '/email-otp/send-verification-otp': ['POST'],
  '/sign-in/email-otp': ['POST'],
  '/delete-user': ['POST'],
}

/** Sign-in requests are a few hundred bytes. */
export const MAX_AUTH_REQUEST_BYTES = 4096

/** What the published version says about sign-in (cached per version, like its tables). */
export interface AppSignIn {
  on: boolean
  name: string
  /** Who can open the app: its version, rows and proxy answer only them. */
  openTo: OpenTo
  /** Whether people without an account may make one by signing in. */
  signUp: boolean
  /** The emails and `@domains` that may sign in, or null for anyone. */
  allowed: readonly string[] | null
  /** The theme of the app's first page, for its sign-in page (absent: the default theme). */
  theme?: ThemeTokens
}

/** The version's sign-in: its Sign-in feature's settings (src/features/sign-in.ts in the engine), if one generates. */
export function appSignIn(model: AppModel): AppSignIn {
  const result = generate(model)
  const settings = signInOf(result)
  const theme = pageTheme(result.root)
  return {
    on: settings !== null,
    name: model.name,
    openTo: settings?.openTo ?? 'anyone',
    signUp: settings?.signUp ?? true,
    allowed: settings?.allowed ?? null,
    ...(theme ? { theme } : {}),
  }
}

/** What the sign-in routes need for the app a request is for. */
export interface SignInTarget {
  model: string
  signIn: AppSignIn
  db: D1Database | undefined
  /** None where the Worker has no bindings. */
  tables: AuthTables | undefined
  /** The platform's secret, from which the app's is derived (a Worker secret). */
  secret: string | undefined
  mailer: Mailer | undefined
  waitUntil: (promise: Promise<unknown>) => void
  /** The app's live rows and the published version's Database tables: a person's rows go with their account. */
  rows: { store: RowStore; tables: () => Promise<ReadonlyMap<string, DatabaseTable>> }
}

const NO_SIGN_IN = 'This app has no sign-in'
const NOT_READY = "This app's sign-in isn't set up: publishing it again sets it up"

/** The app's published version was deleted while the request was answered: as if it never was (a 404). */
export class SignInGone extends Error {}

/** Derived secrets by platform secret and key: the same every time, and derived on every session read otherwise. */
const secrets = new Map<string, Promise<string>>()
const MAX_SECRETS = 1000
function secretFor(platformSecret: string, key: string): Promise<string> {
  const id = `${key}:${platformSecret}`
  let secret = secrets.get(id)
  if (!secret) {
    if (secrets.size >= MAX_SECRETS) secrets.delete(secrets.keys().next().value!)
    secret = appSecret(platformSecret, key)
    secrets.set(id, secret)
  }
  return secret
}

/**
 * Upgrades running in this isolate, by model: concurrent requests for one app wait for one upgrade. Never creates
 * tables: an app deleted meanwhile has none, and gets none back (null).
 */
const upgrading = new Map<string, Promise<AppAuth | null>>()
function upgradeOnce(tables: AuthTables, model: string): Promise<AppAuth | null> {
  let running = upgrading.get(model)
  if (!running) {
    running = tables.upgrade(model).finally(() => upgrading.delete(model))
    upgrading.set(model, running)
  }
  return running
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each host's Hono app has its own environment type
export function mountSignIn<A extends Hono<any>>(api: A, target: (c: Context) => Promise<SignInTarget>) {
  const limit = bodyLimit({ maxSize: MAX_AUTH_REQUEST_BYTES, onError: () => error(413, 'The request is too large') })

  /** What was found for the app, or the answer when its version was deleted meanwhile. */
  const find = async (c: Context): Promise<SignInTarget | Response> => {
    try {
      return await target(c)
    } catch (e) {
      if (e instanceof SignInGone) return error(404, e.message)
      throw e
    }
  }

  /** Better Auth for the app (and what was found for it), or the answer when it can't have one. */
  const authOf = async (c: Context, sending = false, given?: SignInTarget) => {
    const found = given ?? (await find(c))
    if (found instanceof Response) return found
    if (!found.signIn.on || !found.db || !found.tables) return error(404, NO_SIGN_IN)
    const current = await found.tables.get(found.model)
    // Its tables are made by the publish, before the app is served: none means that step failed, which publishing again
    // repeats. Not a 404, which would read as an app without sign-in.
    if (!current) return error(503, NOT_READY)
    if (!found.secret) return error(503, "Sign-in isn't set up on this server")
    if (sending && !found.mailer) return error(503, "Sign-in email isn't set up on this server")
    // Its tables are made when a version with sign-in is published, and brought up to date here, once, after a deploy
    // adds a step (db:upgrade-apps does every app right after the deploy, so this is rarely more than a read).
    const tables = current.schemaVersion < AUTH_SCHEMA_STEPS.length ? await upgradeOnce(found.tables, found.model) : current
    if (!tables) return error(404, NO_SIGN_IN)
    const { allowed } = found.signIn
    const { rows, model } = found
    const auth = authFor({
      db: found.db,
      key: tables.key,
      secret: await secretFor(found.secret, tables.key),
      baseURL: new URL(c.req.url).origin,
      appName: found.signIn.name,
      mailer: found.mailer ?? { send: () => Promise.reject(new Error('No mailer')) },
      waitUntil: found.waitUntil,
      signUp: found.signIn.signUp,
      ...(allowed ? { allows: (email: string) => onAllowedList(allowed, email) } : {}),
      // Their rows go, except in tables set to keep them, which keep them without their name.
      forgetUser: async (userId) => {
        const keep = [...(await rows.tables()).values()].filter((t) => t.access.deletedAccounts === 'keep').map((t) => t.key)
        await rows.store.forgetPerson(model, 'live', userId, keep)
      },
    })
    return { auth, found }
  }

  api.all('/app/auth/*', limit, async (c) => {
    const path = c.req.path.slice(AUTH_BASE_PATH.length)
    const methods = AUTH_ENDPOINTS[path]
    if (!methods) return error(404, 'No such API endpoint')
    if (!methods.includes(c.req.method)) return error(405, 'Method not allowed', { allow: methods.join(', ') })
    // Changes come only from the app's own page, as JSON. Better Auth checks the Origin only once a cookie is sent, and
    // reads form bodies too, so another site could otherwise sign a visitor in to an account of its own (login CSRF):
    // a cross-site form or no-cors fetch can send neither a same-origin Origin nor application/json.
    if (c.req.method !== 'GET') {
      if (c.req.header('Origin') !== new URL(c.req.url).origin) return error(403, "Sign-in is only sent from the app's own pages")
      if (!sendsJson(c.req.raw)) return error(415, 'Send the request as application/json')
    }
    const sending = path === '/email-otp/send-verification-otp'
    const app = await authOf(c, sending)
    if (app instanceof Response) return app
    // Only sign-in codes: the plugin's other kinds (verifying an address, resetting a password) aren't offered. A body
    // that doesn't parse goes on to Better Auth, which says what is wrong with it.
    const type = sending ? await readType(c.req.raw) : undefined
    if (type !== undefined && type !== 'sign-in') return error(400, 'Only sign-in codes are sent', { problems: ['Ask for type "sign-in"'] })
    return withoutTokens(await app.auth.handler(c.req.raw))
  })

  // What the app holds about the person signed in, to download: their account, sessions and the rows they added. Only
  // from the app's own page (or typed in the address bar), so another site can't make a visitor's browser download it.
  api.get('/app/account', async (c) => {
    const site = c.req.header('Sec-Fetch-Site')
    if (site && site !== 'same-origin' && site !== 'none') return error(403, "Your data is downloaded from the app's own page")
    const app = await authOf(c)
    if (app instanceof Response) return app
    const { auth, found } = app
    const headers = c.req.raw.headers
    const session = await auth.api.getSession({ headers })
    if (!session) return error(401, 'Sign in first')
    const sessions = await auth.api.listSessions({ headers })
    const { user } = session
    const [byTable, tables] = await Promise.all([found.rows.store.rowsBy(found.model, 'live', user.id), found.rows.tables()])
    return c.json(
      {
        app: found.signIn.name,
        exported_at: new Date().toISOString(),
        account: { id: user.id, email: user.email, name: user.name, email_verified: user.emailVerified, created_at: user.createdAt },
        sessions: sessions.map((s) => ({ created_at: s.createdAt, expires_at: s.expiresAt, ip_address: s.ipAddress, user_agent: s.userAgent })),
        // By table, named as the published version names it (a table it no longer has, by its key).
        rows: Object.entries(byTable).map(([key, rows]) => ({ table: tables.get(key)?.name ?? key, rows: rows.map(pageRow) })),
      },
      200,
      { 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="account.json"' },
    )
  })
  api.all('/app/account', () => error(405, 'Method not allowed', { allow: 'GET' }))

  return {
    /**
     * Whether a request may see the app: its version, rows and proxy. An app open to anyone, or without sign-in, lets
     * everyone in; otherwise only a person signed in (else a 401), and for a list, only while their email is on it
     * (else a 403; the list may have changed since they signed in). Each answer names the app, for its sign-in page. An
     * app that needs sign-in but can't check it (no secret, no tables) lets no one in. In an app open to anyone with
     * sign-in, `person` says whether to read the session too: `needed` (a table's rule needs to know who asks), or
     * `wanted` (a row is added, which remembers who added it if someone signed in did: only read when a session cookie
     * is sent, and a sign-in that can't be checked doesn't refuse it).
     */
    async visitor(c: Context, person: 'needed' | 'wanted' | false = false): Promise<Visitor> {
      const found = await find(c)
      if (found instanceof Response) return { refused: found }
      if (!found.signIn.on) return { gated: false, signIn: false }
      const open = found.signIn.openTo === 'anyone'
      if (open && (!person || (person === 'wanted' && !hasSessionCookie(c.req.raw)))) return { gated: false, signIn: true }
      const app = await authOf(c, false, found)
      if (app instanceof Response) return open && person === 'wanted' ? { gated: false, signIn: true } : { refused: app }
      // Reading a session past its update age extends it: the renewed cookie goes out with the answer.
      const { headers, response: session } = await app.auth.api.getSession({ headers: c.req.raw.headers, returnHeaders: true })
      const cookies = headers.getSetCookie()
      const { name, allowed, theme } = found.signIn
      const page = { app: name, ...(theme ? { theme } : {}) }
      // Open to anyone: someone signed out still sees the app (a table's rules say what they may do).
      if (!session) return open ? { gated: true, cookies, person: null } : { refused: signInAnswer(401, 'Sign in to open this app', page, cookies) }
      if (allowed && !onAllowedList(allowed, session.user.email))
        return { refused: signInAnswer(403, 'This app is open only to the people it lists', { ...page, email: session.user.email }, cookies) }
      return { gated: true, cookies, person: session.user.id }
    },
  }
}

/**
 * Whether a request may see the app: `refused` with the answer, or let in. `gated` when that took a session (so the
 * answer is the person's own, never for a shared cache), with any cookie the session read renewed and the `person`
 * signed in (their id; null for no one). Ungated, `signIn` says whether the app has sign-in at all.
 */
export type Visitor = { refused: Response } | { gated: false; signIn: boolean } | { gated: true; cookies: readonly string[]; person: string | null }

/** What an app asking for sign-in answers: its page shows the sign-in page for `sign_in`. Never cached. */
export interface SignInAnswer {
  error: string
  /** The app's name and theme, for its sign-in page; `email`: the person signed in, whom the list leaves out. */
  sign_in: { app: string; theme?: ThemeTokens; email?: string }
}

function signInAnswer(status: 401 | 403, message: string, signIn: SignInAnswer['sign_in'], cookies: readonly string[]) {
  const answer = Response.json({ error: message, sign_in: signIn } satisfies SignInAnswer, { status, headers: { 'Cache-Control': 'no-store' } })
  for (const cookie of cookies) answer.headers.append('Set-Cookie', cookie)
  return answer
}

/** Whether a request carries a session cookie of an app (`fd.session_token`, `__Host-fd.session_token` on https). */
export const hasSessionCookie = (request: Request) => /(?:^|;\s*)(?:__Host-)?fd\.session_token=/.test(request.headers.get('Cookie') ?? '')

/** The `type` a code request asks for: null when it names none, undefined when the body isn't JSON. */
async function readType(request: Request): Promise<unknown> {
  try {
    const body = (await request.clone().json()) as { type?: unknown } | null
    return body?.type ?? null
  } catch {
    return undefined
  }
}

/**
 * Better Auth's answer, without the session token in its body (sign-in and session reads carry it): it lives only in
 * the HttpOnly cookie, out of the page's reach. Never cached.
 */
export async function withoutTokens(response: Response): Promise<Response> {
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  if (!headers.get('Content-Type')?.includes('application/json')) return new Response(response.body, { status: response.status, headers })
  const text = await response.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return new Response(text, { status: response.status, headers })
  }
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    delete record.token
    if (record.session && typeof record.session === 'object') delete (record.session as Record<string, unknown>).token
  }
  headers.delete('Content-Length')
  return new Response(JSON.stringify(body), { status: response.status, headers })
}
