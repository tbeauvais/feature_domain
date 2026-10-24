import type { AppModel } from '@feature-domain/engine'
import { toJson } from '../src/d1ModelStore'
import { HOME_ID } from '../src/home'

/** The settings row recording that the samples were seeded, so models the user deletes don't come back. */
export const SEEDED_KEY = 'samples-seeded'

/** The id each sample is stored under, so a seed that stopped partway can be finished without storing one twice. */
export const sampleId = (set: number, index: number) => `sample-${set}-${index + 1}`

/**
 * How many samples the first seeds stored together, under `SEEDED_KEY`. Each sample added since (Team requests) has a
 * setting of its own, so a database seeded before it gets it once, and keeps it deleted once deleted.
 */
export const FIRST_SAMPLES = 6

/** The settings row recording that a sample added after the first ones was seeded. */
export const sampleSeededKey = (id: string) => `sample-seeded:${id}`

/**
 * SQL that stores `models` (rows as D1ModelStore writes them, in this order) unless the database was seeded before,
 * then records the seeding. Running it again changes nothing, locally or on Cloudflare.
 *
 * The first `together` samples share one setting. Locally wrangler runs the file in one transaction; on Cloudflare it
 * runs statement by statement. So that setting is written first as `seeding` and set to `set` last: a seed that stopped
 * partway is still `seeding`, and running it again stores only the samples missing (by id). Each later sample is stored
 * unless its own setting says it was, then that setting is written.
 */
export function seedSql(models: readonly AppModel[], set: number, now = Date.now(), together = FIRST_SAMPLES): string {
  const key = text(SEEDED_KEY)
  const seeding = `EXISTS (SELECT 1 FROM settings WHERE key = ${key} AND value = 'seeding')`
  const row = (model: AppModel, i: number) => [text(sampleId(set, i)), text(model.name), text(toJson(model)), now, now].join(', ')
  return [
    `INSERT OR IGNORE INTO settings (key, value) VALUES (${key}, 'seeding');`,
    ...models
      .slice(0, together)
      .map((model, i) => `INSERT OR IGNORE INTO models (id, name, model, created_at, updated_at) SELECT ${row(model, i)} WHERE ${seeding};`),
    `UPDATE settings SET value = ${text(String(set))} WHERE key = ${key} AND value = 'seeding';`,
    ...models.slice(together).flatMap((model, j) => {
      const i = together + j
      const own = text(sampleSeededKey(sampleId(set, i)))
      return [
        `INSERT OR IGNORE INTO models (id, name, model, created_at, updated_at) SELECT ${row(model, i)} WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = ${own});`,
        `INSERT OR IGNORE INTO settings (key, value) VALUES (${own}, '1');`,
      ]
    }),
    '',
  ].join('\n')
}

/** The settings row recording that the home model was seeded, so a home page the user deletes doesn't come back. */
export const HOME_SEEDED_KEY = 'home-seeded'

/**
 * SQL that stores the home model under `HOME_ID` unless it was seeded before (and never over a stored one), then
 * records the seeding. Run again, or after stopping between the two statements, it changes nothing.
 */
export function homeSeedSql(model: AppModel, now = Date.now()): string {
  const key = text(HOME_SEEDED_KEY)
  return [
    `INSERT OR IGNORE INTO models (id, name, model, created_at, updated_at) SELECT ${[text(HOME_ID), text(model.name), text(toJson(model)), now, now].join(', ')} WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = ${key});`,
    `INSERT OR IGNORE INTO settings (key, value) VALUES (${key}, '1');`,
    '',
  ].join('\n')
}

/** A SQL string literal. JSON escapes control characters, so quotes are the only thing to double. */
const text = (value: string) => `'${value.replaceAll("'", "''")}'`
