import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppModel } from '@feature-domain/engine'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { SAMPLE_MODELS } from '../../web/src/data/sampleModels'
import { seedSql, SEEDED_KEY } from '../scripts/seedSql'
import { D1ModelStore } from '../src/d1ModelStore'
import { localD1, wrangler, type LocalD1 } from './localD1'

let d1: LocalD1
beforeAll(async () => {
  d1 = await localD1()
}, 60_000)
afterAll(() => d1?.dispose())

/** Runs seed SQL through wrangler, as `npm run db:seed` does. */
function seed(models: readonly AppModel[]) {
  const file = join(d1.dir, `seed-${Math.random()}.sql`)
  writeFileSync(file, seedSql(models, 2))
  wrangler(d1.dir, 'd1', 'execute', 'DB', '--file', file)
}

it('seeds the samples once, in order, as D1ModelStore reads them', async () => {
  seed(SAMPLE_MODELS)
  const store = new D1ModelStore(d1.env.DB)
  const listed = await store.list()
  expect(listed.map((m) => m.name)).toEqual(SAMPLE_MODELS.map((m) => m.name))
  for (const [i, { id }] of listed.entries()) expect(await store.get(id)).toEqual({ ...SAMPLE_MODELS[i], id })
  expect(await d1.env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(SEEDED_KEY).first('value')).toBe('2')

  // Deleted samples don't come back when seeding runs again.
  await store.delete(listed[0]!.id)
  seed(SAMPLE_MODELS)
  expect(await store.list()).toEqual(listed.slice(1))
}, 60_000)

it('stores names and text holding quotes and semicolons as they are', async () => {
  await d1.env.DB.exec('DELETE FROM models')
  await d1.env.DB.exec('DELETE FROM settings')
  const model: AppModel = { version: 2, name: "Tom's café; DROP TABLE models; --", features: [] }
  seed([model])
  const store = new D1ModelStore(d1.env.DB)
  const [listed] = await store.list()
  expect(await store.get(listed!.id)).toEqual({ ...model, id: listed!.id })
}, 60_000)
