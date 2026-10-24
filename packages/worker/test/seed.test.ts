import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppModel } from '@feature-domain/engine'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { SAMPLE_MODELS } from '../../web/src/data/sampleModels'
import { FIRST_SAMPLES, HOME_SEEDED_KEY, homeSeedSql, seedSql, SEEDED_KEY } from '../scripts/seedSql'
import { D1ModelStore } from '../src/d1ModelStore'
import { HOME_ID, homeModel } from '../src/home'
import { localD1, wrangler, type LocalD1 } from './localD1'

let d1: LocalD1
beforeAll(async () => {
  d1 = await localD1()
}, 60_000)
afterAll(() => d1?.dispose())

/** Runs seed SQL through wrangler, as `npm run db:seed` does. */
function seed(models: readonly AppModel[], sql = seedSql(models, 2)) {
  const file = join(d1.dir, `seed-${Math.random()}.sql`)
  writeFileSync(file, sql)
  wrangler(d1.dir, 'd1', 'execute', 'DB', '--file', file)
}

async function clear() {
  await d1.env.DB.exec('DELETE FROM models')
  await d1.env.DB.exec('DELETE FROM settings')
}

it('seeds the samples once, in order, as D1ModelStore reads them', async () => {
  seed(SAMPLE_MODELS)
  const store = new D1ModelStore(d1.env.DB)
  const listed = await store.list()
  expect(listed.map((m) => m.name)).toEqual(SAMPLE_MODELS.map((m) => m.name))
  for (const [i, { id }] of listed.entries()) expect(await store.get(id)).toEqual({ model: { ...SAMPLE_MODELS[i], id }, revision: 1 })
  expect(await d1.env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(SEEDED_KEY).first('value')).toBe('2')

  // Deleted samples don't come back when seeding runs again.
  await store.delete(listed[0]!.id)
  seed(SAMPLE_MODELS)
  expect(await store.list()).toEqual(listed.slice(1))
}, 60_000)

it('adds a sample written after a database was seeded once, and keeps it deleted once deleted', async () => {
  await clear()
  // A database seeded with the first samples, before the later ones were written.
  seed(SAMPLE_MODELS.slice(0, FIRST_SAMPLES))
  const store = new D1ModelStore(d1.env.DB)
  expect(await store.list()).toHaveLength(FIRST_SAMPLES)
  const first = (await store.list())[0]!
  await store.delete(first.id)

  seed(SAMPLE_MODELS)
  const names = (await store.list()).map((m) => m.name)
  expect(names).toEqual(SAMPLE_MODELS.slice(1).map((m) => m.name))
  const later = (await store.list()).at(-1)!
  expect(later).toMatchObject({ id: `sample-2-${SAMPLE_MODELS.length}`, name: 'Team requests' })

  await store.delete(later.id)
  seed(SAMPLE_MODELS)
  expect(await store.get(later.id)).toBeNull()
}, 60_000)

it('keeps every sample at its position, as databases remember seeded samples by it', () => {
  // Only ever appended to: a sample moved would take another one's id, and its "seeded" setting with it.
  expect(SAMPLE_MODELS.map((m) => m.name)).toEqual([
    'Start here',
    'Harbor Coffee',
    'Ledgerly pricing',
    'Northwind sales',
    'Tom Beauvais · projects',
    'Shoreline JS meetup',
    'Team requests',
  ])
  expect(FIRST_SAMPLES).toBe(6)
})

it('finishes a seed that stopped partway without storing a sample twice', async () => {
  // On Cloudflare the file runs statement by statement, so a failure can leave some samples stored.
  await clear()
  const statements = seedSql(SAMPLE_MODELS, 2).split('\n')
  seed(SAMPLE_MODELS, statements.slice(0, 3).join('\n'))
  expect(await new D1ModelStore(d1.env.DB).list()).toHaveLength(2)

  seed(SAMPLE_MODELS)
  expect((await new D1ModelStore(d1.env.DB).list()).map((m) => m.name)).toEqual(SAMPLE_MODELS.map((m) => m.name))
  expect(await d1.env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(SEEDED_KEY).first('value')).toBe('2')
}, 60_000)

it('seeds the home model once, alongside samples seeded before, and never over a stored one', async () => {
  await clear()
  seed(SAMPLE_MODELS)
  const store = new D1ModelStore(d1.env.DB)
  seed([], homeSeedSql(homeModel()))
  expect(await store.get(HOME_ID)).toEqual({ model: { ...homeModel(), id: HOME_ID }, revision: 1 })
  expect(await d1.env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(HOME_SEEDED_KEY).first('value')).toBe('1')

  // A deleted home page stays deleted (the app offers Reset home page), and a changed one stays as it is.
  await store.delete(HOME_ID)
  seed([], homeSeedSql(homeModel()))
  expect(await store.get(HOME_ID)).toBeNull()
  await d1.env.DB.exec('DELETE FROM settings')
  await store.put(HOME_ID, { version: 2, name: 'Mine', features: [] })
  seed([], homeSeedSql(homeModel()))
  expect((await store.get(HOME_ID))?.model.name).toBe('Mine')
}, 60_000)

it('keeps every statement within the size D1 runs on Cloudflare', () => {
  // D1 limits a SQL statement to 100,000 bytes on Cloudflare, but not locally.
  for (const statement of (seedSql(SAMPLE_MODELS, 2) + homeSeedSql(homeModel())).split('\n'))
    expect(new TextEncoder().encode(statement).length).toBeLessThan(100_000)
})

it('stores names and text holding quotes and semicolons as they are', async () => {
  await clear()
  const model: AppModel = { version: 2, name: "Tom's café; DROP TABLE models; --", features: [] }
  seed([model])
  const store = new D1ModelStore(d1.env.DB)
  const [listed] = await store.list()
  expect((await store.get(listed!.id))?.model).toEqual({ ...model, id: listed!.id })
}, 60_000)
