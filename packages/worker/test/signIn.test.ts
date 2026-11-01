// A published app's sign-in on its own host (src/auth/route.ts), through the Worker's routes on the real local D1:
// emailed codes, sessions, signing out, deleting an account and downloading it, on two apps at once.

import { onAllowedList, SIGN_IN_FEATURE, type AppModel, type InputValue } from '@feature-domain/engine'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app'
import { appSecret, authFor } from '../src/auth/authFor'
import { MemoryMailer } from '../src/auth/mailer'
import { appSignIn } from '../src/auth/route'
import { D1AuthTables } from '../src/auth/store'
import { authTables, tablesOf } from '../src/auth/tables'
import type { Env } from '../src/env'
import { localD1, type LocalD1 } from './localD1'

const BUILDER = 'http://localhost'
const SECRET = 'platform-secret-for-tests-only-0123456789abcdef'
const IP = '203.0.113.9'

let d1: LocalD1
let env: Env
let db: D1Database
beforeAll(async () => {
  d1 = await localD1()
  env = { ...d1.env, AUTH_SECRET: SECRET }
  db = d1.env.DB
}, 60_000)
afterAll(() => d1?.dispose())

let mailer: MemoryMailer
let tasks: Promise<unknown>[]
let app: ReturnType<typeof createApp>

const tables = () => new D1AuthTables(db)
const authTableNames = async () =>
  (
    await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'app\\_%' ESCAPE '\\' AND name != 'app_auth'").all<{ name: string }>()
  ).results
    .map((r) => r.name)
    .sort()

beforeEach(async () => {
  mailer = new MemoryMailer()
  tasks = []
  app = createApp({ mailer: () => mailer })
  for (const row of (await db.prepare('SELECT model_id FROM app_auth').all<{ model_id: string }>()).results) await tables().drop(row.model_id)
  await db.exec('DELETE FROM models; DELETE FROM rows; DELETE FROM sampled_tables; DELETE FROM apps; DELETE FROM versions; DELETE FROM publishing')
})

const ctx = { waitUntil: (p: Promise<unknown>) => void tasks.push(p), passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext
const request = async (url: string, init?: RequestInit, withEnv: Env = env) =>
  app.fetch(new Request(url.startsWith('/') ? `${BUILDER}${url}` : url, init), withEnv, ctx)
const post = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
})
/** A model with one page; named "… with sign-in", it has a Sign-in feature too (with these inputs). */
const model = (name: string, signIn: Record<string, InputValue> = {}): AppModel => ({
  version: 2,
  name,
  features: [
    { feature: 'PageFeature', id: '1', inputs: { name: 'Home' }, placement: { parent: '$root', slot: 'content' } },
    ...(name.endsWith('with sign-in') ? [{ feature: SIGN_IN_FEATURE, id: '2', inputs: signIn }] : []),
  ],
})

/** Stores and publishes a model at <slug>.localhost; returns its id and revision. */
async function published(name: string, slug: string, signIn: Record<string, InputValue> = {}): Promise<{ id: string; revision: string }> {
  const stored = await request('/api/v1/models', post(model(name, signIn)))
  const id = ((await stored.json()) as { id: string }).id
  const revision = stored.headers.get('ETag')!
  expect((await request(`/api/v1/models/${id}/publish`, post({ slug }, { 'If-Match': revision }))).status).toBe(200)
  return { id, revision }
}

const origin = (slug: string) => `http://${slug}.localhost`
const auth = (slug: string, path: string, init: RequestInit = {}, cookie?: string) =>
  request(`${origin(slug)}/api/v1/app/auth${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Origin: origin(slug), 'cf-connecting-ip': IP, ...(cookie ? { Cookie: cookie } : {}), ...init.headers },
  })
const askCode = (slug: string, email: string) =>
  auth(slug, '/email-otp/send-verification-otp', { method: 'POST', body: JSON.stringify({ email, type: 'sign-in' }) })
const lastCode = () => /code for signing in to .* is (\d{6})/.exec(mailer.sent.at(-1)?.text ?? '')?.[1]

/** Signs in with an emailed code; returns the Cookie header the browser sends next, and the sign-in answer's body. */
async function signInAt(slug: string, email: string): Promise<{ cookie: string; body: Record<string, unknown> }> {
  expect((await askCode(slug, email)).status).toBe(200)
  await Promise.all(tasks)
  const signed = await auth(slug, '/sign-in/email-otp', { method: 'POST', body: JSON.stringify({ email, otp: lastCode() }) })
  expect(signed.status).toBe(200)
  const cookie = signed.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  return { cookie, body: (await signed.json()) as Record<string, unknown> }
}
const sessionAt = async (slug: string, cookie: string) =>
  (await (await auth(slug, '/get-session', {}, cookie)).json()) as { user: { id: string; email: string }; session: Record<string, unknown> } | null

describe('signing in', () => {
  it('emails a code from the app, sent in the background, which signs in', async () => {
    await published('Shoreline meetup with sign-in', 'meetup')
    expect(await askCode('meetup', 'ann@example.com').then((r) => r.json())).toEqual({ success: true })
    expect(tasks).toHaveLength(1)
    await Promise.all(tasks)
    expect(mailer.sent).toEqual([
      expect.objectContaining({
        to: 'ann@example.com',
        fromName: 'Shoreline meetup with sign-in via localhost',
        subject: 'Your sign-in code for Shoreline meetup with sign-in (meetup.localhost)',
      }),
    ])
    expect(mailer.sent[0]!.text).toContain(`${origin('meetup')}/sign-in?email=ann%40example.com#code=${lastCode()}`)
    const { cookie } = await signInAt('meetup', 'ann@example.com')
    expect((await sessionAt('meetup', cookie))?.user.email).toBe('ann@example.com')
  })

  it('gives one email a separate account on each app, and refuses one app’s cookie on another', async () => {
    const meetup = await published('Shoreline meetup with sign-in', 'meetup')
    const tracker = await published('Team requests with sign-in', 'tracker')
    const a = await signInAt('meetup', 'ann@example.com')
    const b = await signInAt('tracker', 'ann@example.com')
    const userA = (await sessionAt('meetup', a.cookie))!.user
    const userB = (await sessionAt('tracker', b.cookie))!.user
    expect(userA.id).not.toBe(userB.id)
    expect(await sessionAt('tracker', a.cookie)).toBeNull()
    expect(await sessionAt('meetup', b.cookie)).toBeNull()
    for (const { id } of [meetup, tracker]) {
      const { key } = (await tables().get(id))!
      expect(await db.prepare(`SELECT count(*) AS n FROM "${authTables(key).user}"`).first('n')).toBe(1)
    }
  })

  it('keeps the session token out of answers: it is only in the HttpOnly cookie', async () => {
    await published('Shoreline meetup with sign-in', 'meetup')
    const { cookie, body } = await signInAt('meetup', 'ann@example.com')
    expect(body).not.toHaveProperty('token')
    expect(body).toMatchObject({ user: { email: 'ann@example.com' } })
    const session = await sessionAt('meetup', cookie)
    expect(session?.session).not.toHaveProperty('token')
    const answer = await auth('meetup', '/get-session', {}, cookie)
    expect(answer.headers.get('Cache-Control')).toBe('no-store')
  })

  it('signs out', async () => {
    await published('Shoreline meetup with sign-in', 'meetup')
    const { cookie } = await signInAt('meetup', 'ann@example.com')
    expect((await auth('meetup', '/sign-out', { method: 'POST', body: '{}' }, cookie)).status).toBe(200)
    expect(await sessionAt('meetup', cookie)).toBeNull()
  })

  it('refuses a wrong code', async () => {
    await published('Shoreline meetup with sign-in', 'meetup')
    await askCode('meetup', 'ann@example.com')
    await Promise.all(tasks)
    const wrong = lastCode() === '000000' ? '111111' : '000000'
    expect((await auth('meetup', '/sign-in/email-otp', { method: 'POST', body: JSON.stringify({ email: 'ann@example.com', otp: wrong }) })).status).toBe(400)
  })

  it('limits code requests per address, but not session reads', async () => {
    await published('Shoreline meetup with sign-in', 'meetup')
    const statuses = []
    for (let i = 0; i < 4; i++) statuses.push((await askCode('meetup', 'ann@example.com')).status)
    expect(statuses).toEqual([200, 200, 200, 429])
    for (let i = 0; i < 5; i++) expect((await auth('meetup', '/get-session')).status).toBe(200)
  })
})

describe('what an app answers', () => {
  it('only the sign-in endpoints, with their methods', async () => {
    await published('Shoreline meetup with sign-in', 'meetup')
    for (const path of ['/sign-up/email', '/list-sessions', '/update-user', '/change-email', '/ok', '/email-otp/check-verification-otp'])
      expect((await auth('meetup', path, { method: 'POST', body: '{}' })).status, path).toBe(404)
    expect((await auth('meetup', '/sign-out')).status).toBe(405)
    const put = await auth('meetup', '/sign-out', { method: 'PUT', body: '{}' })
    expect(put.status).toBe(405)
    expect(put.headers.get('Allow')).toBe('POST')
    expect((await auth('meetup', '/get-session', { method: 'POST', body: '{}' })).status).toBe(405)
  })

  it('sends only sign-in codes', async () => {
    await published('Shoreline meetup with sign-in', 'meetup')
    for (const type of ['email-verification', 'forget-password', undefined]) {
      const answer = await auth('meetup', '/email-otp/send-verification-otp', { method: 'POST', body: JSON.stringify({ email: 'ann@example.com', type }) })
      expect(answer.status).toBe(400)
    }
    expect(mailer.sent).toEqual([])
  })

  it('nothing for an app published without sign-in, or once a version without it is published', async () => {
    await published('Harbor Coffee', 'harbor')
    expect((await auth('harbor', '/get-session')).status).toBe(404)
    const { id, revision } = await published('Shoreline meetup with sign-in', 'meetup')
    const { cookie } = await signInAt('meetup', 'ann@example.com')
    // The next version leaves sign-in out: the app's accounts are kept (its tables), but nobody signs in.
    const saved = await request(`/api/v1/models/${id}`, {
      ...post(model('Shoreline meetup')),
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': revision },
    })
    expect((await request(`/api/v1/models/${id}/publish`, post({}, { 'If-Match': saved.headers.get('ETag')! }))).status).toBe(200)
    expect((await auth('meetup', '/get-session', {}, cookie)).status).toBe(404)
    expect(await tables().get(id)).not.toBeNull()
  })

  it('nothing where no app is published', async () => {
    expect((await auth('nobody', '/get-session')).status).toBe(404)
  })

  it('a 404, not a 400, for a code of another kind from an app without sign-in', async () => {
    await published('Harbor Coffee', 'harbor')
    const answer = await auth('harbor', '/email-otp/send-verification-otp', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@example.com', type: 'forget-password' }),
    })
    expect(answer.status).toBe(404)
  })

  it('a 503 when the server has no secret, or no way to send email', async () => {
    await published('Shoreline meetup with sign-in', 'meetup')
    const { AUTH_SECRET: _, ...noSecret } = env
    void _
    expect((await request(`${origin('meetup')}/api/v1/app/auth/get-session`, {}, noSecret)).status).toBe(503)
    app = createApp({ mailer: () => undefined })
    expect((await askCode('meetup', 'ann@example.com')).status).toBe(503)
    expect((await auth('meetup', '/get-session')).status).toBe(200)
  })

  it('a 503 of its own when a version with sign-in has no tables (its publish failed at that step)', async () => {
    const { id } = await published('Shoreline meetup with sign-in', 'meetup')
    await tables().drop(id)
    const answer = await auth('meetup', '/get-session')
    expect(answer.status).toBe(503)
    expect(await answer.json()).toEqual({ error: "This app's sign-in isn't set up: publishing it again sets it up" })
  })

  it('gives no tables back to an app deleted while its tables were being upgraded', async () => {
    const { id } = await published('Shoreline meetup with sign-in', 'meetup')
    const real = tables()
    const stale = (await real.get(id))!
    // Read as outdated just before the model's deletion dropped its tables.
    await real.drop(id)
    const racing = new D1AuthTables(db)
    let first = true
    racing.get = async (modelId) => (first ? ((first = false), { ...stale, schemaVersion: 0 }) : D1AuthTables.prototype.get.call(racing, modelId))
    app = createApp({ mailer: () => mailer, authTables: () => racing })
    expect((await auth('meetup', '/get-session')).status).toBe(404)
    expect(await real.get(id)).toBeNull()
    expect(await authTableNames()).toEqual([])
  })

  it('brings outdated tables up to date when the app is next asked', async () => {
    const { id } = await published('Shoreline meetup with sign-in', 'meetup')
    const { key } = (await tables().get(id))!
    // As if made before every step: no tables yet at schema version 0.
    for (const table of tablesOf(authTables(key))) await db.exec(`DROP TABLE "${table}"`)
    await db.prepare('UPDATE app_auth SET schema_version = 0 WHERE model_id = ?').bind(id).run()
    const answers = await Promise.all(Array.from({ length: 5 }, () => auth('meetup', '/get-session')))
    expect(answers.map((a) => a.status)).toEqual([200, 200, 200, 200, 200])
    expect(await authTableNames()).toEqual(tablesOf(authTables(key)).sort())
  })
})

describe('the account', () => {
  it('downloads what the app holds about the person signed in, without tokens', async () => {
    await published('Shoreline meetup with sign-in', 'meetup')
    const { cookie } = await signInAt('meetup', 'ann@example.com')
    const answer = await request(`${origin('meetup')}/api/v1/app/account`, { headers: { Cookie: cookie } })
    expect(answer.status).toBe(200)
    expect(answer.headers.get('Content-Disposition')).toBe('attachment; filename="account.json"')
    const body = (await answer.json()) as Record<string, unknown>
    expect(body).toMatchObject({ app: 'Shoreline meetup with sign-in', account: { email: 'ann@example.com', email_verified: true } })
    expect(body.sessions).toEqual([expect.objectContaining({ ip_address: IP })])
    expect(JSON.stringify(body)).not.toContain(cookie.split('=')[1]!.split('.')[0]!)
    expect((await request(`${origin('meetup')}/api/v1/app/account`)).status).toBe(401)
  })

  it('deletes the account and its sessions', async () => {
    const { id } = await published('Shoreline meetup with sign-in', 'meetup')
    const { cookie } = await signInAt('meetup', 'ann@example.com')
    const deleted = await auth('meetup', '/delete-user', { method: 'POST', body: '{}' }, cookie)
    expect(deleted.status).toBe(200)
    expect(await sessionAt('meetup', cookie)).toBeNull()
    const { key } = (await tables().get(id))!
    expect(await db.prepare(`SELECT count(*) AS n FROM "${authTables(key).user}"`).first('n')).toBe(0)
    expect(await db.prepare(`SELECT count(*) AS n FROM "${authTables(key).session}"`).first('n')).toBe(0)
  })
})

describe('who may sign in (the Sign-in feature sets these)', () => {
  it("reads the version's Sign-in feature: none, the defaults, or its settings", () => {
    expect(appSignIn(model('Club'))).toEqual({ on: false, name: 'Club', openTo: 'anyone', signUp: true, allowed: null })
    expect(appSignIn(model('Club with sign-in'))).toEqual({ on: true, name: 'Club with sign-in', openTo: 'anyone', signUp: true, allowed: null })
    expect(appSignIn(model('Club with sign-in', { open_to: 'signed-in', sign_up: false }))).toMatchObject({ on: true, openTo: 'signed-in', signUp: false })
    expect(appSignIn(model('Club with sign-in', { open_to: 'listed', allowed: ['Ann@Example.com', '@club.example'] }))).toMatchObject({
      openTo: 'listed',
      signUp: true,
      allowed: ['ann@example.com', '@club.example'],
    })
    expect(appSignIn(model('Club with sign-in', { disable: true })).on).toBe(false)
    // Its sign-in page takes the theme of the app's first page.
    const themed: AppModel = {
      ...model('Club with sign-in'),
      features: [
        { feature: 'ThemeFeature', id: '3', inputs: { accent: '#2255aa' } },
        { feature: 'PageFeature', id: '1', inputs: { name: 'Home', theme: '3' }, placement: { parent: '$root', slot: 'content' } },
        { feature: SIGN_IN_FEATURE, id: '2', inputs: {} },
      ],
    }
    expect(appSignIn(themed).theme?.vars).toMatchObject({ '--fd-accent': expect.any(String) })
    expect(appSignIn(model('Club with sign-in')).theme).toBeUndefined()
  })

  /** Better Auth for one app with these settings, called directly. */
  async function appWith(settings: { signUp?: boolean; allows?: (email: string) => boolean }) {
    const { key } = await tables().ensure('model-settings')
    const sent = new MemoryMailer()
    const background: Promise<unknown>[] = []
    const instance = authFor({
      db,
      key,
      secret: await appSecret(SECRET, key),
      baseURL: origin('club'),
      appName: 'Club',
      mailer: sent,
      waitUntil: (p) => void background.push(p),
      ...settings,
    })
    const call = async (path: string, body: unknown) => {
      const answer = await instance.handler(
        new Request(`${origin('club')}/api/v1/app/auth${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: origin('club'), 'cf-connecting-ip': IP },
          body: JSON.stringify(body),
        }),
      )
      await Promise.all(background)
      return { status: answer.status, body: await answer.text() }
    }
    return { call, sent }
  }

  it('with sign-up closed, answers an unknown address as a known one, and sends it nothing', async () => {
    const club = await appWith({ signUp: false })
    const unknown = await club.call('/email-otp/send-verification-otp', { email: 'new@example.com', type: 'sign-in' })
    expect(unknown).toEqual({ status: 200, body: '{"success":true}' })
    expect(club.sent.sent).toEqual([])
    const guessed = await club.call('/sign-in/email-otp', { email: 'new@example.com', otp: '123456' })
    expect(guessed.status).toBe(400)
  })

  it('refuses a code sent while an address was allowed, once it no longer is, as a wrong code', async () => {
    const list = ['@club.example']
    const club = await appWith({ allows: (email) => onAllowedList(list, email) })
    await club.call('/email-otp/send-verification-otp', { email: 'ann@club.example', type: 'sign-in' })
    const code = /is (\d{6})\./.exec(club.sent.sent.at(-1)!.text)![1]!
    const wrong = await club.call('/sign-in/email-otp', { email: 'ann@club.example', otp: code === '000000' ? '111111' : '000000' })
    list.length = 0
    const refused = await club.call('/sign-in/email-otp', { email: 'ann@club.example', otp: code })
    expect(refused).toEqual(wrong)
    expect(refused.status).toBe(400)
    // Allowed again, the code still works: the refusal used up nothing.
    list.push('@club.example')
    expect((await club.call('/sign-in/email-otp', { email: 'ann@club.example', otp: code })).status).toBe(200)
  })

  it('answers an address not on the list as one on it, and sends it nothing', async () => {
    const club = await appWith({ allows: (email) => email.endsWith('@club.example') })
    const listed = await club.call('/email-otp/send-verification-otp', { email: 'ann@club.example', type: 'sign-in' })
    const unlisted = await club.call('/email-otp/send-verification-otp', { email: 'bob@example.com', type: 'sign-in' })
    expect(unlisted).toEqual(listed)
    expect(club.sent.sent.map((m) => m.to)).toEqual(['ann@club.example'])
  })
})

describe('who can open the app (the Sign-in feature’s Who can open)', () => {
  const at = (slug: string, path: string, cookie?: string, init: RequestInit = {}) =>
    request(`${origin(slug)}/api/v1/app${path}`, { ...init, headers: { ...(cookie ? { Cookie: cookie } : {}), ...init.headers } })
  const proxy = (slug: string, cookie?: string) =>
    at(slug, '/proxy', cookie, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'GET', url: 'https://example.com/' }),
    })
  /** Saves and publishes the next version, with these Sign-in inputs. */
  async function republish(id: string, revision: string, name: string, signIn: Record<string, InputValue>) {
    const saved = await request(`/api/v1/models/${id}`, {
      ...post(model(name, signIn)),
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': revision },
    })
    expect((await request(`/api/v1/models/${id}/publish`, post({}, { 'If-Match': saved.headers.get('ETag')! }))).status).toBe(200)
  }

  it('anyone, by default: the version, rows and proxy answer without signing in', async () => {
    await published('Shoreline meetup with sign-in', 'meetup')
    expect((await at('meetup', '')).status).toBe(200)
    expect((await at('meetup', '/tables/9/rows')).status).toBe(404)
  })

  it('people signed in: the rest get a 401 naming the app, for its sign-in page, until they sign in', async () => {
    await published('Members with sign-in', 'members', { open_to: 'signed-in' })
    for (const answer of [await at('members', ''), await at('members', '/tables/9/rows'), await proxy('members')]) {
      expect(answer.status).toBe(401)
      expect(answer.headers.get('Cache-Control')).toBe('no-store')
      expect(await answer.json()).toEqual({ error: 'Sign in to open this app', sign_in: { app: 'Members with sign-in' } })
    }
    // Signing in itself stays open.
    const { cookie } = await signInAt('members', 'ann@example.com')
    const version = await at('members', '', cookie)
    expect(version.status).toBe(200)
    expect(((await version.json()) as AppModel).name).toBe('Members with sign-in')
    // Past the gate, the table is simply not there.
    expect((await at('members', '/tables/9/rows', cookie)).status).toBe(404)
    expect((await auth('members', '/sign-out', { method: 'POST', body: '{}' }, cookie)).status).toBe(200)
    expect((await at('members', '', cookie)).status).toBe(401)
  })

  it('a cookie from another app opens nothing', async () => {
    await published('Members with sign-in', 'members', { open_to: 'signed-in' })
    await published('Shoreline meetup with sign-in', 'meetup')
    const { cookie } = await signInAt('meetup', 'ann@example.com')
    expect((await at('members', '', cookie)).status).toBe(401)
  })

  it('listed people: only they get a code, and they lose the app once the list leaves them out', async () => {
    const { id, revision } = await published('Board with sign-in', 'board', { open_to: 'listed', allowed: ['ann@example.com', '@board.example'] })
    expect((await askCode('board', 'eve@example.com')).status).toBe(200)
    await Promise.all(tasks)
    expect(mailer.sent).toEqual([])
    const { cookie } = await signInAt('board', 'ann@example.com')
    expect((await at('board', '', cookie)).status).toBe(200)

    const stored = await request(`/api/v1/models/${id}`)
    expect(stored.headers.get('ETag')).toBe(revision)
    await republish(id, revision, 'Board with sign-in', { open_to: 'listed', allowed: ['@board.example'] })
    const refused = await at('board', '', cookie)
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({
      error: 'This app is open only to the people it lists',
      sign_in: { app: 'Board with sign-in', email: 'ann@example.com' },
    })
    expect((await proxy('board', cookie)).status).toBe(403)
    // Opening it to anyone lets everyone in again.
    await republish(id, (await request(`/api/v1/models/${id}`)).headers.get('ETag')!, 'Board with sign-in', { open_to: 'anyone' })
    expect((await at('board', '')).status).toBe(200)
  })

  it('lets no one in where it can’t check: no secret, or no tables', async () => {
    const { id } = await published('Members with sign-in', 'members', { open_to: 'signed-in' })
    const { AUTH_SECRET: _, ...noSecret } = env
    void _
    expect((await request(`${origin('members')}/api/v1/app`, {}, noSecret)).status).toBe(503)
    await tables().drop(id)
    expect((await at('members', '')).status).toBe(503)
  })

  it('a disabled Sign-in opens the app to anyone', async () => {
    await published('Members with sign-in', 'members', { open_to: 'signed-in', disable: true })
    expect((await at('members', '')).status).toBe(200)
  })

  it('answers a member privately, varying by cookie; an open app as before', async () => {
    await published('Members with sign-in', 'members', { open_to: 'signed-in' })
    const { cookie } = await signInAt('members', 'ann@example.com')
    const version = await at('members', '', cookie)
    expect(version.headers.get('Cache-Control')).toBe('private, no-cache')
    expect(version.headers.get('Vary')).toContain('Cookie')
    expect((await at('members', '/tables/9/rows', cookie)).headers.get('Cache-Control')).toMatch(/^private/)
    await published('Shoreline meetup with sign-in', 'meetup')
    expect((await at('meetup', '')).headers.get('Cache-Control')).toBe('no-cache')
  })

  it('a method a route doesn’t take is its 405, signed in or not', async () => {
    await published('Members with sign-in', 'members', { open_to: 'signed-in' })
    expect((await at('members', '', undefined, { method: 'POST' })).status).toBe(405)
    expect((await at('members', '/proxy')).status).toBe(405)
    expect((await at('members', '/tables/9/rows', undefined, { method: 'PUT' })).status).toBe(405)
    expect((await at('members', '/tables/9/rows/01J0000000000000000000000A', undefined, { method: 'POST' })).status).toBe(405)
    // The methods they do take are still gated, one row as the whole table.
    expect((await at('members', '/tables/9/rows', undefined, { method: 'POST' })).status).toBe(401)
    expect((await at('members', '/tables/9/rows/01J0000000000000000000000A', undefined, { method: 'DELETE' })).status).toBe(401)
  })

  it('renews the session cookie when reading the session extends it', async () => {
    const { id } = await published('Members with sign-in', 'members', { open_to: 'signed-in' })
    const { cookie } = await signInAt('members', 'ann@example.com')
    // As if signed in days ago: the session is past its update age, so reading it extends it.
    const { key } = (await tables().get(id))!
    await db
      .prepare(`UPDATE "${authTables(key).session}" SET "expiresAt" = ?`)
      .bind(new Date(Date.now() + 3600_000).toISOString())
      .run()
    const version = await at('members', '', cookie)
    expect(version.status).toBe(200)
    expect(version.headers.getSetCookie().some((c) => c.startsWith('fd.session_token='))).toBe(true)
  })
})

describe('only from the app’s own pages', () => {
  it('refuses a change from another site, or with no Origin, or not as JSON (no login CSRF)', async () => {
    await published('Shoreline meetup with sign-in', 'meetup')
    const body = JSON.stringify({ email: 'ann@example.com', type: 'sign-in' })
    const path = '/email-otp/send-verification-otp'
    expect((await auth('meetup', path, { method: 'POST', body, headers: { Origin: 'https://evil.example' } })).status).toBe(403)
    expect((await auth('meetup', path, { method: 'POST', body, headers: { Origin: origin('tracker') } })).status).toBe(403)
    const noOrigin = await request(`${origin('meetup')}/api/v1/app/auth${path}`, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } })
    expect(noOrigin.status).toBe(403)
    // A cross-site form's body: also how a form-encoded `type` would get past the sign-in-codes-only check.
    const form = await auth('meetup', path, {
      method: 'POST',
      body: 'email=ann%40example.com&type=forget-password',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    expect(form.status).toBe(415)
    expect(mailer.sent).toEqual([])
  })

  it('refuses signing in or out from another site, keeping the session', async () => {
    await published('Shoreline meetup with sign-in', 'meetup')
    const { cookie } = await signInAt('meetup', 'ann@example.com')
    expect((await auth('meetup', '/sign-out', { method: 'POST', body: '{}', headers: { Origin: 'https://evil.example' } }, cookie)).status).toBe(403)
    expect((await auth('meetup', '/delete-user', { method: 'POST', body: '{}', headers: { Origin: 'https://evil.example' } }, cookie)).status).toBe(403)
    expect((await sessionAt('meetup', cookie))?.user.email).toBe('ann@example.com')
    const attacker = await auth('meetup', '/sign-in/email-otp', {
      method: 'POST',
      body: JSON.stringify({ email: 'eve@example.com', otp: '123456' }),
      headers: { Origin: 'https://evil.example' },
    })
    expect(attacker.status).toBe(403)
    expect(attacker.headers.getSetCookie()).toEqual([])
  })
})

describe('in development', () => {
  it('sends codes to the log and keeps them for the end-to-end tests, read on the app’s host', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    app = createApp()
    await published('Shoreline meetup with sign-in', 'meetup')
    expect((await askCode('meetup', 'ann@example.com')).status).toBe(200)
    await Promise.all(tasks)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Sign-in email to ann@example.com'))
    log.mockRestore()
    const mails = (await (await request(`${origin('meetup')}/api/v1/app/dev/mail?to=ann%40example.com`)).json()) as { text: string }[]
    expect(mails).toHaveLength(1)
    expect(mails[0]!.text).toMatch(/is \d{6}\./)
    expect(await (await request(`${origin('meetup')}/api/v1/app/dev/mail?to=bob%40example.com`)).json()).toEqual([])
    // Another app's host serves only its own.
    await published('Harbor club with sign-in', 'harbor')
    expect(await (await request(`${origin('harbor')}/api/v1/app/dev/mail?to=ann%40example.com`)).json()).toEqual([])
  })

  it('serves no mail where the apps’ domain isn’t localhost, nor with a mailer of its own', async () => {
    await published('Shoreline meetup with sign-in', 'meetup')
    expect((await request(`${origin('meetup')}/api/v1/app/dev/mail?to=a%40example.com`)).status).toBe(404)
    app = createApp({ hosts: { builder: 'app.feature-domain.workers.dev', apps: 'apprun.app' } })
    expect((await request('https://meetup.apprun.app/api/v1/app/dev/mail?to=a%40example.com')).status).toBe(404)
  })
})

describe('over https, as deployed', () => {
  const HOSTS = { builder: 'app.feature-domain.workers.dev', apps: 'apprun.app' }
  const at = (slug: string) => `https://${slug}.apprun.app`

  async function publishedHere(name: string, slug: string) {
    app = createApp({ mailer: () => mailer, hosts: HOSTS })
    const stored = await request(`https://${HOSTS.builder}/api/v1/models`, post(model(name)))
    const id = ((await stored.json()) as { id: string }).id
    const answer = await request(`https://${HOSTS.builder}/api/v1/models/${id}/publish`, post({ slug }, { 'If-Match': stored.headers.get('ETag')! }))
    expect(answer.status).toBe(200)
  }
  const call = (slug: string, path: string, body?: unknown, cookie?: string) =>
    request(`${at(slug)}/api/v1/app/auth${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Origin: at(slug), 'cf-connecting-ip': IP, ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  it('sends plain http to https, keeping the method, and every answer carries HSTS', async () => {
    await publishedHere('Shoreline meetup with sign-in', 'meetup')
    const plain = await request('http://meetup.apprun.app/api/v1/app/auth/sign-out?x=1', { method: 'POST' })
    expect(plain.status).toBe(308)
    expect(plain.headers.get('Location')).toBe('https://meetup.apprun.app/api/v1/app/auth/sign-out?x=1')
    expect(plain.headers.getSetCookie()).toEqual([])
    const secure = await call('meetup', '/get-session')
    expect(secure.headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains')
    expect((await request(`${at('meetup')}/api/v1/app`)).headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains')
  })

  it('signs in with __Host- cookies: Secure, HttpOnly, SameSite=Lax, Path=/, no Domain', async () => {
    await publishedHere('Shoreline meetup with sign-in', 'meetup')
    expect((await call('meetup', '/email-otp/send-verification-otp', { email: 'ann@example.com', type: 'sign-in' })).status).toBe(200)
    await Promise.all(tasks)
    const signed = await call('meetup', '/sign-in/email-otp', { email: 'ann@example.com', otp: lastCode() })
    expect(signed.status).toBe(200)
    const cookies = signed.headers.getSetCookie()
    const token = cookies.find((c) => c.startsWith('__Host-fd.session_token='))
    expect(token).toBeDefined()
    for (const attribute of [/; Secure/i, /; HttpOnly/i, /; SameSite=Lax/i, /; Path=\//i]) expect(token).toMatch(attribute)
    expect(token).not.toMatch(/Domain=/i)
    const cookie = cookies.map((c) => c.split(';')[0]).join('; ')
    expect(((await (await call('meetup', '/get-session', undefined, cookie)).json()) as { user: { email: string } }).user.email).toBe('ann@example.com')
  })
})

describe('the account’s safeguards', () => {
  it('deletes an account only after a recent sign-in', async () => {
    const { id } = await published('Shoreline meetup with sign-in', 'meetup')
    const { cookie } = await signInAt('meetup', 'ann@example.com')
    const { key } = (await tables().get(id))!
    // Signed in two days ago (Better Auth asks for one within a day).
    const twoDaysAgo = Date.now() - 2 * 86_400_000
    await db
      .prepare(`UPDATE "${authTables(key).session}" SET createdAt = ?, updatedAt = ?`)
      .bind(twoDaysAgo, twoDaysAgo)
      .run()
    const refused = await auth('meetup', '/delete-user', { method: 'POST', body: '{}' }, cookie)
    expect(refused.status).not.toBe(200)
    expect(await db.prepare(`SELECT count(*) AS n FROM "${authTables(key).user}"`).first('n')).toBe(1)
  })

  it('spends a code after three wrong tries', async () => {
    await published('Shoreline meetup with sign-in', 'meetup')
    await askCode('meetup', 'ann@example.com')
    await Promise.all(tasks)
    const code = lastCode()!
    const wrong = code === '000000' ? '111111' : '000000'
    // From different addresses, so only the code's own limit applies (the rate limit counts per IP).
    const tryCode = (otp: string, ip: string) =>
      auth('meetup', '/sign-in/email-otp', { method: 'POST', body: JSON.stringify({ email: 'ann@example.com', otp }), headers: { 'cf-connecting-ip': ip } })
    for (const ip of ['198.51.100.1', '198.51.100.2', '198.51.100.3']) expect((await tryCode(wrong, ip)).status).toBe(400)
    const late = await tryCode(code, '198.51.100.4')
    expect(late.status).not.toBe(200)
    expect(late.headers.getSetCookie()).toEqual([])
  })
})
