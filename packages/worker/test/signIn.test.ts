// A published app's sign-in on its own host (src/auth/route.ts), through the Worker's routes on the real local D1:
// emailed codes, sessions, signing out, deleting an account and downloading it, on two apps at once.

import type { AppModel } from '@feature-domain/engine'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { appSecret, authFor } from '../src/auth/authFor'
import { MemoryMailer } from '../src/auth/mailer'
import { appSignIn, onList } from '../src/auth/route'
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
/** Until the engine has a Sign-in feature, a model "has sign-in" by its name. */
const signIn = (model: AppModel) => model.name.endsWith('with sign-in')
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
  app = createApp({ signIn, mailer: () => mailer })
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
const model = (name: string): AppModel => ({
  version: 2,
  name,
  features: [{ feature: 'PageFeature', id: '1', inputs: { name: 'Home' }, placement: { parent: '$root', slot: 'content' } }],
})

/** Stores and publishes a model at <slug>.localhost; returns its id and revision. */
async function published(name: string, slug: string): Promise<{ id: string; revision: string }> {
  const stored = await request('/api/v1/models', post(model(name)))
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
    app = createApp({ signIn, mailer: () => undefined })
    expect((await askCode('meetup', 'ann@example.com')).status).toBe(503)
    expect((await auth('meetup', '/get-session')).status).toBe(200)
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
  it('is anyone, with sign-up open, until the Sign-in feature says otherwise', () => {
    expect(appSignIn(model('Club'), () => true)).toEqual({ on: true, name: 'Club', signUp: true, allowed: null })
  })

  it('matches listed emails exactly and listed @domains by their end, whatever the case', () => {
    const list = ['ann@example.com', '@Club.Example']
    expect(onList(list, 'ANN@example.com')).toBe(true)
    expect(onList(list, 'bob@club.example')).toBe(true)
    expect(onList(list, 'bob@example.com')).toBe(false)
    expect(onList(list, 'bob@notclub.example')).toBe(false)
    expect(onList(list, 'ann@example.com.evil')).toBe(false)
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

  it('answers an address not on the list as one on it, and sends it nothing', async () => {
    const club = await appWith({ allows: (email) => email.endsWith('@club.example') })
    const listed = await club.call('/email-otp/send-verification-otp', { email: 'ann@club.example', type: 'sign-in' })
    const unlisted = await club.call('/email-otp/send-verification-otp', { email: 'bob@example.com', type: 'sign-in' })
    expect(unlisted).toEqual(listed)
    expect(club.sent.sent.map((m) => m.to)).toEqual(['ann@club.example'])
  })
})
