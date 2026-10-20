import type { AppModel } from '@feature-domain/engine'
import { toJson } from '../src/d1ModelStore'
import { HOME_ID } from '../src/home'

/** The settings row recording that the samples were seeded, so models the user deletes don't come back. */
export const SEEDED_KEY = 'samples-seeded'

/** The id each sample is stored under, so a seed that stopped partway can be finished without storing one twice. */
export const sampleId = (set: number, index: number) => `sample-${set}-${index + 1}`

/**
 * SQL that stores `models` (rows as D1ModelStore writes them, in this order) unless the database was seeded before,
 * then records the seeding. Running it again changes nothing, locally or on Cloudflare.
 *
 * Locally wrangler runs the file in one transaction; on Cloudflare it runs statement by statement. So the setting is
 * written first as `seeding` and set to `set` last: a seed that stopped partway is still `seeding`, and running it
 * again stores only the samples missing (by id).
 */
export function seedSql(models: readonly AppModel[], set: number, now = Date.now()): string {
  const key = text(SEEDED_KEY)
  const seeding = `EXISTS (SELECT 1 FROM settings WHERE key = ${key} AND value = 'seeding')`
  return [
    `INSERT OR IGNORE INTO settings (key, value) VALUES (${key}, 'seeding');`,
    ...models.map(
      (model, i) =>
        `INSERT OR IGNORE INTO models (id, name, model, created_at, updated_at) SELECT ${[text(sampleId(set, i)), text(model.name), text(toJson(model)), now, now].join(', ')} WHERE ${seeding};`,
    ),
    `UPDATE settings SET value = ${text(String(set))} WHERE key = ${key} AND value = 'seeding';`,
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
