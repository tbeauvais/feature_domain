// Published apps' sign-in tables (src/auth/store.ts) on the real local D1: creating, upgrading and dropping them, at
// once from several requests, and through publishing and deleting a model.

import type { AppModel } from '@feature-domain/engine'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { hasSignIn, SIGN_IN_FEATURE } from '../src/auth/signIn'
import { D1AuthTables, MemoryAuthTables, type AuthTables } from '../src/auth/store'
import { AUTH_SCHEMA_STEPS, authTables, tablesOf, type AuthSchemaStep } from '../src/auth/tables'
import type { Env } from '../src/env'
import { localD1, type LocalD1 } from './localD1'

let d1: LocalD1
let env: Env
let db: D1Database
let store: D1AuthTables
beforeAll(async () => {
  d1 = await localD1()
  env = d1.env
  db = env.DB
  store = new D1AuthTables(db)
}, 60_000)
afterAll(() => d1?.dispose())

/** Every app's auth table in the database. */
const authTableNames = async () =>
  (
    await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'app\\_%' ESCAPE '\\' AND name != 'app_auth'").all<{ name: string }>()
  ).results
    .map((r) => r.name)
    .sort()

const columns = async (table: string) => (await db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all<{ name: string }>()).results.map((c) => c.name)

/** A schema with one more step: a column added to the user table. */
const withNickname: AuthSchemaStep[] = [...AUTH_SCHEMA_STEPS, (t) => [`ALTER TABLE "${t.user}" ADD COLUMN "nickname" text`]]

beforeEach(async () => {
  for (const row of (await db.prepare('SELECT model_id FROM app_auth').all<{ model_id: string }>()).results) await store.drop(row.model_id)
  for (const name of await authTableNames()) await db.exec(`DROP TABLE "${name}"`)
  await db.exec('DELETE FROM models; DELETE FROM rows; DELETE FROM sampled_tables; DELETE FROM apps; DELETE FROM versions; DELETE FROM publishing')
})

// What publishing and deleting rely on, from both implementations (the memory one serves the web tests' in-process API).
describe.each([
  ['D1AuthTables', () => new D1AuthTables(db)],
  ['MemoryAuthTables', () => new MemoryAuthTables()],
] as [string, () => AuthTables][])('%s', (_, make) => {
  it('ensures once per model, keeps the key, and forgets it when dropped', async () => {
    const tables = make()
    expect(await tables.get('model-a')).toBeNull()
    const a = await tables.ensure('model-a')
    expect(a).toEqual({ key: expect.stringMatching(/^[0-9a-f]{32}$/), schemaVersion: AUTH_SCHEMA_STEPS.length })
    expect(await tables.ensure('model-a')).toEqual(a)
    expect((await tables.ensure('model-b')).key).not.toBe(a.key)
    await tables.drop('model-a')
    await tables.drop('model-never')
    expect(await tables.get('model-a')).toBeNull()
    expect(await tables.get('model-b')).not.toBeNull()
  })
})

describe('the tables', () => {
  it('relies on a D1 batch being one transaction: a failing statement takes a CREATE TABLE back too', async () => {
    await expect(db.batch([db.prepare('CREATE TABLE app_rollback_probe (id text)'), db.prepare('INSERT INTO no_such_table VALUES (1)')])).rejects.toThrow()
    expect(await db.prepare("SELECT name FROM sqlite_master WHERE name = 'app_rollback_probe'").first()).toBeNull()
  })

  it('creates five tables named after a random key, and the app_auth row; ensuring again changes nothing', async () => {
    // A seeded sample's id: the key never comes from it.
    const first = await store.ensure('sample-2-6')
    expect(first.key).toMatch(/^[0-9a-f]{32}$/)
    expect(first.schemaVersion).toBe(AUTH_SCHEMA_STEPS.length)
    expect(await authTableNames()).toEqual(tablesOf(authTables(first.key)).sort())
    expect(await store.ensure('sample-2-6')).toEqual(first)
    expect(await store.get('sample-2-6')).toEqual(first)
  })

  it('gives each app its own key', async () => {
    const a = await store.ensure('model-a')
    const b = await store.ensure('model-b')
    expect(a.key).not.toBe(b.key)
    expect(await authTableNames()).toHaveLength(10)
  })

  it('ends requests creating the same app at once with one key, one set of tables and no error', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => store.ensure('model-race')))
    expect(new Set(results.map((r) => r.key)).size).toBe(1)
    expect(await authTableNames()).toHaveLength(5)
  })

  it('applies only the missing steps, keeping the key and what the tables hold', async () => {
    const { key } = await store.ensure('model-up')
    const t = authTables(key)
    await db.prepare(`INSERT INTO "${t.user}" (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('u1', '', 'ann@example.com', 1, 0, 0)`).run()
    const upgraded = await new D1AuthTables(db, withNickname).ensure('model-up')
    expect(upgraded).toEqual({ key, schemaVersion: withNickname.length })
    expect(await columns(t.user)).toContain('nickname')
    expect(await db.prepare(`SELECT email FROM "${t.user}"`).first('email')).toBe('ann@example.com')
  })

  it('upgrades from requests at once without errors (the column is not added twice)', async () => {
    await store.ensure('model-up')
    const results = await Promise.all(Array.from({ length: 6 }, () => new D1AuthTables(db, withNickname).ensure('model-up')))
    expect(results.every((r) => r.schemaVersion === withNickname.length)).toBe(true)
  })

  it('adds nothing when the app it read was dropped before its upgrade ran (no orphan tables)', async () => {
    const { key } = await store.ensure('model-stale')
    const stale = await store.get('model-stale')
    await store.drop('model-stale')
    // A step that only adds a table would succeed on its own, with no app to belong to.
    const upgrading = new D1AuthTables(db, [...AUTH_SCHEMA_STEPS, (t) => [`CREATE TABLE "${t.user}_extra" (id text)`]])
    // Reads the dropped app's record once, as a request that read it just before the drop would.
    let first = true
    upgrading.get = async (modelId) => (first ? ((first = false), stale) : D1AuthTables.prototype.get.call(upgrading, modelId))
    const made = await upgrading.ensure('model-stale')
    // It read again, found no tables, and made a fresh set under a new key.
    expect(made.key).not.toBe(key)
    for (const table of await authTableNames()) expect(table).not.toContain(key)
  })

  it('upgrades the tables under the key the app has now, when it was dropped and made again since it was read', async () => {
    const old = await store.ensure('model-again')
    await store.drop('model-again')
    const now = await store.ensure('model-again')
    const upgrading = new D1AuthTables(db, [...AUTH_SCHEMA_STEPS, (t) => [`CREATE TABLE "${t.user}_extra" (id text)`]])
    let first = true
    upgrading.get = async (modelId) => (first ? ((first = false), old) : D1AuthTables.prototype.get.call(upgrading, modelId))
    expect(await upgrading.ensure('model-again')).toEqual({ key: now.key, schemaVersion: AUTH_SCHEMA_STEPS.length + 1 })
    const names = await authTableNames()
    expect(names).toContain(`${authTables(now.key).user}_extra`)
    for (const table of names) expect(table).not.toContain(old.key)
  })

  it('keeps an app made again under a new key when a drop that read the old one runs late', async () => {
    const old = await store.ensure('model-again')
    await store.drop('model-again')
    const now = await store.ensure('model-again')
    const dropping = new D1AuthTables(db)
    dropping.get = async () => old
    await dropping.drop('model-again')
    expect(await store.get('model-again')).toEqual(now)
    expect(await authTableNames()).toEqual(tablesOf(authTables(now.key)).sort())
  })

  it('throws a failing step at once, without running it again', async () => {
    await store.ensure('model-bad')
    let batches = 0
    const counting = { prepare: (sql: string) => db.prepare(sql), batch: (list: D1PreparedStatement[]) => (batches++, db.batch(list)) } as unknown as D1Database
    const failing = new D1AuthTables(counting, [...AUTH_SCHEMA_STEPS, () => ['ALTER TABLE no_such_table ADD COLUMN x text']])
    await expect(failing.ensure('model-bad')).rejects.toThrow()
    expect(batches).toBe(1)
    expect((await store.get('model-bad'))?.schemaVersion).toBe(AUTH_SCHEMA_STEPS.length)
  })

  it('drops every table and the row; dropping an app without tables does nothing', async () => {
    await store.ensure('model-drop')
    await store.ensure('model-kept')
    await store.drop('model-drop')
    await store.drop('model-never')
    expect(await store.get('model-drop')).toBeNull()
    expect(await authTableNames()).toEqual(tablesOf(authTables((await store.get('model-kept'))!.key)).sort())
  })

  it('names tables only after a 32-hex key', () => {
    expect(() => authTables('sample-2-6')).toThrow()
    expect(() => authTables('0123456789abcdef0123456789abcdeF')).toThrow()
    expect(() => authTables('0123456789abcdef0123456789abcdef"; DROP TABLE models; --')).toThrow()
  })
})

describe('upgrading every app', () => {
  const storeModel = (id: string) =>
    db.prepare("INSERT INTO models (id, name, model, created_at, updated_at, revision) VALUES (?, 'M', '{}', 0, 0, 1)").bind(id).run()

  it('upgrades outdated apps, drops those of deleted models and sweeps orphan tables', async () => {
    await storeModel('model-old')
    await storeModel('model-current')
    const old = await store.ensure('model-old')
    const upgradedSteps = new D1AuthTables(db, withNickname)
    await upgradedSteps.ensure('model-current')
    const gone = await store.ensure('model-gone')
    // Tables no app_auth row names (none should exist; e.g. left by a failure outside a batch).
    const orphanKey = 'ffffffffffffffffffffffffffffffff'
    for (const sql of AUTH_SCHEMA_STEPS[0]!(authTables(orphanKey))) await db.exec(sql.replace(/\n/g, ' '))

    const report = await upgradedSteps.upgradeAll()
    expect(report).toEqual({ upgraded: ['model-old'], dropped: ['model-gone'], orphans: [orphanKey] })
    expect(await columns(authTables(old.key).user)).toContain('nickname')
    expect(await store.get('model-gone')).toBeNull()
    for (const key of [gone.key, orphanKey]) for (const table of tablesOf(authTables(key))) expect(await authTableNames()).not.toContain(table)
    // Done: running it again changes nothing.
    expect(await upgradedSteps.upgradeAll()).toEqual({ upgraded: [], dropped: [], orphans: [] })
  })
})

describe('publishing and deleting', () => {
  const BUILDER = 'http://localhost'
  const json = (body: unknown, method = 'POST', headers: Record<string, string> = {}): RequestInit => ({
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  const page = { feature: 'PageFeature', id: '1', inputs: { name: 'Home' }, placement: { parent: '$root', slot: 'content' } }
  /** Until the engine has a Sign-in feature, a model "has sign-in" by its name. */
  const signIn = (model: AppModel) => model.name.endsWith('with sign-in')
  const model = (name: string): AppModel => ({ version: 2, name, features: [page] })

  async function stored(own: ReturnType<typeof createApp>, m: AppModel): Promise<{ id: string; revision: string }> {
    const response = await own.request(`${BUILDER}/api/v1/models`, json(m), env)
    return { id: ((await response.json()) as { id: string }).id, revision: response.headers.get('ETag')! }
  }
  const publish = (own: ReturnType<typeof createApp>, id: string, revision: string, slug: string) =>
    own.request(`${BUILDER}/api/v1/models/${id}/publish`, json({ slug }, 'POST', { 'If-Match': revision }), env)

  it('counts a Sign-in feature only when it generates', () => {
    expect(hasSignIn(model('Plain'))).toBe(false)
    // Not a feature the engine knows yet (it comes with the sign-in page), so it doesn't generate.
    expect(hasSignIn({ ...model('Signed'), features: [page, { feature: SIGN_IN_FEATURE, id: '2', inputs: {} }] })).toBe(false)
  })

  it('creates the tables when a version with sign-in is published, and keeps them for the next', async () => {
    const own = createApp({ signIn })
    const { id, revision } = await stored(own, model('Meetup with sign-in'))
    expect((await publish(own, id, revision, 'meetup')).status).toBe(200)
    const auth = await store.get(id)
    expect(auth).not.toBeNull()
    expect((await publish(own, id, revision, 'meetup')).status).toBe(200)
    expect(await store.get(id)).toEqual(auth)
  })

  it('creates none for a version without sign-in', async () => {
    const own = createApp({ signIn })
    const { id, revision } = await stored(own, model('Harbor Coffee'))
    expect((await publish(own, id, revision, 'harbor')).status).toBe(200)
    expect(await store.get(id)).toBeNull()
    expect(await authTableNames()).toEqual([])
  })

  it('drops them when the model is deleted', async () => {
    const own = createApp({ signIn })
    const { id, revision } = await stored(own, model('Meetup with sign-in'))
    await publish(own, id, revision, 'meetup')
    expect((await own.request(`${BUILDER}/api/v1/models/${id}`, { method: 'DELETE' }, env)).status).toBe(204)
    expect(await store.get(id)).toBeNull()
    expect(await authTableNames()).toEqual([])
  })

  it('leaves no tables for a model deleted meanwhile when its publish then fails (its address taken)', async () => {
    const tables = new D1AuthTables(db)
    const ensure = tables.ensure.bind(tables)
    let resume!: () => void
    let reached!: () => void
    const paused = new Promise<void>((resolve) => (reached = resolve))
    tables.ensure = async (modelId) => {
      const made = await ensure(modelId)
      reached()
      await new Promise<void>((resolve) => (resume = resolve))
      return made
    }
    const own = createApp({ signIn, authTables: () => tables })
    const other = await stored(own, model('Harbor Coffee'))
    expect((await publish(own, other.id, other.revision, 'meetup')).status).toBe(200)
    const { id, revision } = await stored(own, model('Meetup with sign-in'))
    const publishing = publish(own, id, revision, 'meetup')
    await paused
    expect((await own.request(`${BUILDER}/api/v1/models/${id}`, { method: 'DELETE' }, env)).status).toBe(204)
    resume()
    expect((await publishing).status).toBe(409)
    expect(await store.get(id)).toBeNull()
    expect(await authTableNames()).toEqual([])
  })

  it('still deletes the model when dropping its tables fails, and leaves them for db:upgrade-apps', async () => {
    const tables = new D1AuthTables(db)
    const own = createApp({ signIn, authTables: () => tables })
    const { id, revision } = await stored(own, model('Meetup with sign-in'))
    await publish(own, id, revision, 'meetup')
    tables.drop = () => Promise.reject(new Error('D1 is down'))
    expect((await own.request(`${BUILDER}/api/v1/models/${id}`, { method: 'DELETE' }, env)).status).toBe(204)
    expect((await own.request(`${BUILDER}/api/v1/models/${id}`, undefined, env)).status).toBe(404)
    expect(await store.upgradeAll()).toMatchObject({ dropped: [id] })
    expect(await authTableNames()).toEqual([])
  })

  for (const when of ['before', 'after'] as const)
    it(`leaves no tables for a model deleted while it is published (deleted ${when} its tables are made)`, async () => {
      const tables = new D1AuthTables(db)
      const ensure = tables.ensure.bind(tables)
      let resume!: () => void
      let reached!: () => void
      const paused = new Promise<void>((resolve) => (reached = resolve))
      tables.ensure = async (modelId) => {
        const pause = async () => {
          reached()
          await new Promise<void>((resolve) => (resume = resolve))
        }
        if (when === 'before') await pause()
        const made = await ensure(modelId)
        if (when === 'after') await pause()
        return made
      }
      const own = createApp({ signIn, authTables: () => tables })
      const { id, revision } = await stored(own, model('Meetup with sign-in'))
      const publishing = publish(own, id, revision, 'meetup')
      await paused
      // Deleting never waits for a publish.
      expect((await own.request(`${BUILDER}/api/v1/models/${id}`, { method: 'DELETE' }, env)).status).toBe(204)
      resume()
      expect((await publishing).status).toBe(404)
      expect(await store.get(id)).toBeNull()
      expect(await authTableNames()).toEqual([])
    })
})
