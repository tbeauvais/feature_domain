import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { WORKER_DIR } from '../scripts/wrangler'
import { D1ModelStore } from '../src/d1ModelStore'
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
  const statements = sql.split(';').map((s) => s.trim()).filter(Boolean)
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
