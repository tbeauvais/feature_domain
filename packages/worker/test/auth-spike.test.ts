// Spike, Data Apps iteration 3 (PR 0): Better Auth on local D1 with per-app tables and secrets. Each test is one of
// the spike's gates; the findings are written up in spike/FINDINGS.md.

import type { AppModel } from '@feature-domain/engine'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { appSecret, authFor, MemoryMailer } from '../src/auth/authFor'
import { appAuth, dropAuthTables, ensureAuthTables } from '../src/auth/store'
import { AUTH_SCHEMA_STEPS, authTables, tablesOf } from '../src/auth/tables'
import { localD1, type LocalD1 } from './localD1'

const PLATFORM_SECRET = 'platform-secret-for-tests-only-0123456789'

let d1: LocalD1
let db: D1Database
beforeAll(async () => {
  d1 = await localD1()
  db = d1.env.DB
}, 60_000)
afterAll(() => d1?.dispose())

/** A D1 binding that records every statement it is given (Better Auth detects D1 by prepare, batch and exec). */
function recording(target: D1Database) {
  const statements: string[] = []
  const binding = {
    prepare: (sql: string) => {
      statements.push(sql)
      return target.prepare(sql)
    },
    batch: (list: D1PreparedStatement[]) => target.batch(list),
    exec: (sql: string) => {
      statements.push(sql)
      return target.exec(sql)
    },
    dump: () => target.dump(),
    withSession: (...args: Parameters<D1Database['withSession']>) => target.withSession(...args),
  } as unknown as D1Database
  return { binding, statements }
}

const tables = async () =>
  (
    await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'app\\_%' ESCAPE '\\' AND name != 'app_auth'").all<{ name: string }>()
  ).results.map((r) => r.name)

async function wipeAuth() {
  for (const row of (await db.prepare('SELECT model_id FROM app_auth').all<{ model_id: string }>()).results) await dropAuthTables(db, row.model_id)
}

/** One published app's auth: its tables, secret and address, with what Better Auth sends to D1 recorded. */
async function appFor(modelId: string, baseURL: string, { cookieCache = false, secret }: { cookieCache?: boolean; secret?: string } = {}) {
  const { key } = await ensureAuthTables(db, modelId)
  const { binding, statements } = recording(db)
  const mailer = new MemoryMailer()
  const tasks: Promise<unknown>[] = []
  const auth = authFor({
    db: binding,
    key,
    secret: secret ?? (await appSecret(PLATFORM_SECRET, key)),
    baseURL,
    mailer,
    waitUntil: (p) => tasks.push(p),
    cookieCache,
  })
  const call = (path: string, init: RequestInit = {}, cookie?: string) =>
    auth.handler(
      new Request(`${baseURL}/api/v1/app/auth${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Origin: baseURL,
          'cf-connecting-ip': '203.0.113.7',
          ...(cookie ? { Cookie: cookie } : {}),
          ...init.headers,
        },
      }),
    )
  /** Signs in with an emailed code; returns the Cookie header the browser would send next. */
  async function signIn(email: string): Promise<{ cookie: string; setCookies: string[] }> {
    const sent = await call('/email-otp/send-verification-otp', { method: 'POST', body: JSON.stringify({ email, type: 'sign-in' }) })
    expect(sent.status).toBe(200)
    await Promise.all(tasks)
    const code = /code is (\d{6})/.exec(mailer.sent.at(-1)!.text)![1]
    const signed = await call('/sign-in/email-otp', { method: 'POST', body: JSON.stringify({ email, otp: code }) })
    expect(signed.status).toBe(200)
    const setCookies = signed.headers.getSetCookie()
    return { cookie: setCookies.map((c) => c.split(';')[0]).join('; '), setCookies }
  }
  const session = async (cookie: string) => (await (await call('/get-session', {}, cookie)).json()) as { user: { id: string; email: string } } | null
  return { key, auth, call, signIn, session, statements, mailer, tasks }
}

describe('auth tables', () => {
  beforeEach(wipeAuth)

  it('a batch with DDL is one transaction: a failing statement takes the CREATE TABLE back too', async () => {
    await expect(db.batch([db.prepare('CREATE TABLE app_rollback_probe (id text)'), db.prepare('INSERT INTO no_such_table VALUES (1)')])).rejects.toThrow()
    expect(await tables()).not.toContain('app_rollback_probe')
  })

  it('creates five tables and the app_auth row once; ensuring again changes nothing', async () => {
    const first = await ensureAuthTables(db, 'sample-2-6')
    expect(first.schemaVersion).toBe(AUTH_SCHEMA_STEPS.length)
    expect((await tables()).sort()).toEqual(tablesOf(authTables(first.key)).sort())
    expect(await ensureAuthTables(db, 'sample-2-6')).toEqual(first)
  })

  it('requests ensuring the same app at once end with one key, one set of tables and no error', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => ensureAuthTables(db, 'model-race')))
    expect(new Set(results.map((r) => r.key)).size).toBe(1)
    expect(await tables()).toHaveLength(5)
  })

  it('upgrades at once without errors (a column added by one request is not added twice)', async () => {
    await ensureAuthTables(db, 'model-up')
    const steps = [...AUTH_SCHEMA_STEPS, (t: ReturnType<typeof authTables>) => [`ALTER TABLE "${t.user}" ADD COLUMN "nickname" text`]]
    const results = await Promise.all(Array.from({ length: 6 }, () => ensureAuthTables(db, 'model-up', steps)))
    expect(results.every((r) => r.schemaVersion === steps.length)).toBe(true)
    const { key } = (await appAuth(db, 'model-up'))!
    const columns = (await db.prepare(`SELECT name FROM pragma_table_info('${authTables(key).user}')`).all<{ name: string }>()).results.map((c) => c.name)
    expect(columns).toContain('nickname')
  })

  it('drops every table and the row', async () => {
    await ensureAuthTables(db, 'model-drop')
    await dropAuthTables(db, 'model-drop')
    expect(await tables()).toEqual([])
    expect(await appAuth(db, 'model-drop')).toBeNull()
  })

  it('refuses a key that is not 32 hex characters', () => {
    expect(() => authTables('sample-2-6')).toThrow()
    expect(() => authTables('0123456789abcdef0123456789abcdeF')).toThrow()
  })
})

describe('signing in on two apps', () => {
  beforeEach(wipeAuth)

  it('one email gets a separate account on each app', async () => {
    const a = await appFor('model-a', 'http://meetup.localhost')
    const b = await appFor('model-b', 'http://tracker.localhost')
    const userA = await a.session((await a.signIn('ann@example.com')).cookie)
    const userB = await b.session((await b.signIn('ann@example.com')).cookie)
    expect(userA?.user.email).toBe('ann@example.com')
    expect(userB?.user.email).toBe('ann@example.com')
    expect(userA!.user.id).not.toBe(userB!.user.id)
    for (const app of [a, b]) {
      const { count } = (await db.prepare(`SELECT count(*) AS count FROM "${authTables(app.key).user}"`).first<{ count: number }>())!
      expect(count).toBe(1)
    }
  })

  it("every statement Better Auth sends names this app's tables, and only them", async () => {
    const a = await appFor('model-a', 'http://meetup.localhost')
    const b = await appFor('model-b', 'http://tracker.localhost')
    const { cookie } = await a.signIn('ann@example.com')
    await a.session(cookie)
    await a.call('/sign-out', { method: 'POST', body: '{}' }, cookie)
    await b.signIn('bob@example.com')
    for (const app of [a, b]) {
      expect(app.statements.length).toBeGreaterThan(0)
      for (const sql of app.statements) {
        const keys = [...sql.matchAll(/app_([0-9a-f]{32})_/g)].map((m) => m[1])
        expect(keys.length, sql).toBeGreaterThan(0)
        expect(new Set(keys), sql).toEqual(new Set([app.key]))
      }
    }
    console.log(`[spike] statements for one sign-in, session read and sign-out:\n${a.statements.join('\n')}`)
  })

  it('a session cookie from one app is refused on another, the cookie cache included', async () => {
    const a = await appFor('model-a', 'http://meetup.localhost', { cookieCache: true })
    const b = await appFor('model-b', 'http://tracker.localhost', { cookieCache: true })
    const { cookie } = await a.signIn('ann@example.com')
    expect(cookie).toMatch(/fd\.session_data=/)
    expect((await a.session(cookie))?.user.email).toBe('ann@example.com')
    expect(await b.session(cookie)).toBeNull()
  })

  it('with one secret shared by every app, the cached session cookie would pass on another app (why secrets are per app)', async () => {
    const shared = 'one-secret-for-every-app-0123456789abcdef'
    const a = await appFor('model-a', 'http://meetup.localhost', { cookieCache: true, secret: shared })
    const b = await appFor('model-b', 'http://tracker.localhost', { cookieCache: true, secret: shared })
    const { cookie } = await a.signIn('ann@example.com')
    const crossed = await b.session(cookie)
    console.log(`[spike] shared secret, A's cookies on B: ${crossed ? `accepted as ${crossed.user.email}` : 'refused'}`)
  })

  it('on https, cookies are __Host- names: Secure, Path=/, no Domain; and they sign in', async () => {
    const a = await appFor('model-a', 'https://meetup.apprun.app')
    const { cookie, setCookies } = await a.signIn('ann@example.com')
    expect(setCookies.length).toBeGreaterThan(0)
    for (const header of setCookies) {
      expect(header).toMatch(/^__Host-fd\./)
      expect(header).toMatch(/; Secure/i)
      expect(header).toMatch(/; Path=\//i)
      expect(header).not.toMatch(/Domain=/i)
    }
    expect((await a.session(cookie))?.user.email).toBe('ann@example.com')
  })

  it('counts requests per cf-connecting-ip in the app’s own rate-limit table', async () => {
    const a = await appFor('model-a', 'http://meetup.localhost')
    const statuses: number[] = []
    for (let i = 0; i < 12; i++)
      statuses.push(
        (await a.call('/email-otp/send-verification-otp', { method: 'POST', body: JSON.stringify({ email: 'ann@example.com', type: 'sign-in' }) })).status,
      )
    const limits = (await db.prepare(`SELECT key, count FROM "${authTables(a.key).rateLimit}"`).all()).results
    console.log(`[spike] 12 code requests: ${statuses.join(' ')}; rate-limit rows: ${JSON.stringify(limits)}`)
    expect(limits.length).toBeGreaterThan(0)
    expect(statuses).toContain(429)
  })

  it('measures building Better Auth per request', async () => {
    const { key } = await ensureAuthTables(db, 'model-a')
    const secret = await appSecret(PLATFORM_SECRET, key)
    const options = { db, key, secret, baseURL: 'http://meetup.localhost', mailer: new MemoryMailer(), waitUntil: () => {} }
    const n = 200
    let start = performance.now()
    for (let i = 0; i < n; i++) authFor(options)
    const build = (performance.now() - start) / n
    start = performance.now()
    for (let i = 0; i < 50; i++)
      await authFor(options).handler(new Request('http://meetup.localhost/api/v1/app/auth/get-session', { headers: { Origin: 'http://meetup.localhost' } }))
    const firstCall = (performance.now() - start) / 50
    start = performance.now()
    for (let i = 0; i < n; i++) await appSecret(PLATFORM_SECRET, key)
    const derive = (performance.now() - start) / n
    console.log(`[spike] per request: build ${build.toFixed(3)} ms; build + get-session (no cookie) ${firstCall.toFixed(2)} ms; secret ${derive.toFixed(3)} ms`)
  })
})

describe('through the Worker: publishing, the app host and deleting', () => {
  const mailer = new MemoryMailer()
  const withSignIn = new Set<string>()
  const app = createApp({ signIn: (model) => withSignIn.has(model.name), mailer: () => mailer })
  const env = () => ({ ...d1.env, AUTH_SECRET: PLATFORM_SECRET })
  const request = (url: string, init?: RequestInit) => app.request(url.startsWith('/') ? `http://localhost${url}` : url, init, env())
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

  /** Stores and publishes a model at <slug>.localhost; returns its id. */
  async function published(name: string, slug: string, signIn: boolean): Promise<string> {
    if (signIn) withSignIn.add(name)
    const stored = await request('/api/v1/models', post(model(name)))
    const id = ((await stored.json()) as { id: string }).id
    const answer = await request(`/api/v1/models/${id}/publish`, post({ slug }, { 'If-Match': stored.headers.get('ETag')! }))
    expect(answer.status).toBe(200)
    return id
  }

  async function signIn(slug: string, email: string): Promise<string> {
    const origin = `http://${slug}.localhost`
    const headers = { Origin: origin, 'cf-connecting-ip': '203.0.113.9' }
    expect((await request(`${origin}/api/v1/app/auth/email-otp/send-verification-otp`, post({ email, type: 'sign-in' }, headers))).status).toBe(200)
    const code = /code is (\d{6})/.exec(mailer.sent.at(-1)!.text)![1]
    const signed = await request(`${origin}/api/v1/app/auth/sign-in/email-otp`, post({ email, otp: code }, headers))
    expect(signed.status).toBe(200)
    return signed.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
  }
  const sessionAt = async (slug: string, cookie: string) =>
    (await (await request(`http://${slug}.localhost/api/v1/app/auth/get-session`, { headers: { Cookie: cookie } })).json()) as {
      user: { email: string }
    } | null

  beforeEach(async () => {
    await wipeAuth()
    await db.exec('DELETE FROM models; DELETE FROM apps; DELETE FROM versions; DELETE FROM publishing')
  })

  it('a publish with sign-in creates the tables; the host decides which app signs in; a cookie stays on its app', async () => {
    const meetup = await published('Shoreline meetup', 'meetup', true)
    await published('Team requests', 'tracker', true)
    expect(await appAuth(db, meetup)).not.toBeNull()
    const cookie = await signIn('meetup', 'ann@example.com')
    expect((await sessionAt('meetup', cookie))?.user.email).toBe('ann@example.com')
    expect(await sessionAt('tracker', cookie)).toBeNull()
  })

  it('an app published without sign-in has no auth tables and no sign-in', async () => {
    const id = await published('Harbor Coffee', 'harbor', false)
    expect(await appAuth(db, id)).toBeNull()
    expect((await request('http://harbor.localhost/api/v1/app/auth/get-session')).status).toBe(404)
  })

  it('deleting the model drops its auth tables', async () => {
    const id = await published('Shoreline meetup', 'meetup', true)
    await signIn('meetup', 'ann@example.com')
    expect((await request(`/api/v1/models/${id}`, { method: 'DELETE' })).status).toBe(204)
    expect(await appAuth(db, id)).toBeNull()
    expect(await tables()).toEqual([])
  })
})
