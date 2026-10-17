import type { AppModel } from '@feature-domain/engine'
import { toJson } from '../src/d1ModelStore'

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

/** A SQL string literal. JSON escapes control characters, so quotes are the only thing to double. */
const text = (value: string) => `'${value.replaceAll("'", "''")}'`
