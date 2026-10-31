import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { WORKER_DIR } from '../scripts/wrangler'
import { D1ModelStore } from '../src/d1ModelStore'
import { D1AppStore } from '../src/d1AppStore'
import { D1RowStore } from '../src/d1RowStore'
import { D1AuthTables } from '../src/auth/store'
import { localD1, type LocalD1 } from './localD1'

// Migrations run on Cloudflare's D1 before the new Worker is uploaded, so each must work on the rows already there.

let d1: LocalD1
beforeAll(async () => {
  d1 = await localD1({ migrate: false })
}, 60_000)
afterAll(() => d1?.dispose())

/** Runs one migration file's statements. */
async function apply(file: string) {
  const sql = readFileSync(join(WORKER_DIR, 'migrations', file), 'utf8').replace(/^--.*$/gm, '')
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  await d1.env.DB.batch(statements.map((s) => d1.env.DB.prepare(s)))
}

it('starts models stored before revisions at revision 1, and saves count on from there', async () => {
  await apply('0001_models.sql')
  // A row as the Worker before 0002 wrote it.
  await d1.env.DB.prepare('INSERT INTO models (id, name, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind('old', 'Old', JSON.stringify({ version: 2, name: 'Old', features: [] }), 1, 1)
    .run()
  await apply('0002_model_revisions.sql')

  const store = new D1ModelStore(d1.env.DB)
  expect(await store.get('old')).toEqual({ model: { version: 2, name: 'Old', features: [], id: 'old' }, revision: 1 })
  expect(await store.update('old', { version: 2, name: 'Saved', features: [] }, 1)).toBe(2)
  // The Worker before 0002 still inserts without a revision while the new one is uploading.
  await d1.env.DB.prepare('INSERT INTO models (id, name, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind('during', 'During', JSON.stringify({ version: 2, name: 'During', features: [] }), 2, 2)
    .run()
  expect((await store.get('during'))?.revision).toBe(1)
})

it('adds rows beside the models stored before, leaving them as they were', async () => {
  await apply('0003_rows.sql')
  const rows = new D1RowStore(d1.env.DB)
  const table = { model: 'old', space: 'draft', table: '2' } as const
  const row = await rows.create(table, { title: 'Kept' })
  expect(await rows.list(table)).toEqual([row])
  expect(await new D1ModelStore(d1.env.DB).get('old')).toMatchObject({ revision: 2 })
  // Rows of an unknown space are refused, and so are sample marks.
  await expect(rows.create({ ...table, space: 'other' as 'live' }, { title: 'x' })).rejects.toThrow(/CHECK/)
  await expect(rows.storeSampleRows({ ...table, space: 'other' as 'live' }, [])).rejects.toThrow(/CHECK/)
})

it('adds published apps beside the models and rows stored before, leaving them as they were', async () => {
  await apply('0004_apps.sql')
  const apps = new D1AppStore(d1.env.DB)
  expect(await apps.publish('old', 'old-app', { version: 2, name: 'Old', features: [] })).toMatchObject({ slug: 'old-app', version: 1 })
  expect((await apps.bySlug('old-app'))?.model).toBe('old')
  expect(await new D1ModelStore(d1.env.DB).get('old')).toMatchObject({ revision: 2 })
  expect(await new D1RowStore(d1.env.DB).list({ model: 'old', space: 'draft', table: '2' })).toHaveLength(1)
})

it('adds publishing claims beside the apps published before, leaving them as they were', async () => {
  await apply('0005_publishing.sql')
  const apps = new D1AppStore(d1.env.DB)
  const token = await apps.claim('old')
  expect(token).toEqual(expect.any(String))
  expect(await apps.claim('old')).toBeNull()
  await apps.release('old', token!)
  expect((await apps.bySlug('old-app'))?.model).toBe('old')
})

it('adds sign-in tables beside the apps published before, leaving them as they were', async () => {
  await apply('0006_app_auth.sql')
  const tables = new D1AuthTables(d1.env.DB)
  expect(await tables.get('old')).toBeNull()
  const made = await tables.ensure('old')
  expect(await tables.get('old')).toEqual(made)
  expect((await new D1AppStore(d1.env.DB).bySlug('old-app'))?.model).toBe('old')
  expect(await new D1ModelStore(d1.env.DB).get('old')).toMatchObject({ revision: 2 })
  expect(await new D1RowStore(d1.env.DB).list({ model: 'old', space: 'draft', table: '2' })).toHaveLength(1)
})
