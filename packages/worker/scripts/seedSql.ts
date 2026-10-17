import type { AppModel } from '@feature-domain/engine'
import { toJson } from '../src/d1ModelStore'

/** The settings row recording that the samples were seeded, so models the user deletes don't come back. */
export const SEEDED_KEY = 'samples-seeded'

/**
 * SQL that stores `models` (rows as D1ModelStore writes them, in this order) unless the database was seeded before,
 * then records the seeding. Running it again changes nothing, locally or on Cloudflare.
 */
export function seedSql(models: readonly AppModel[], set: number, newId: () => string = () => crypto.randomUUID(), now = Date.now()): string {
  const notSeeded = `NOT EXISTS (SELECT 1 FROM settings WHERE key = ${text(SEEDED_KEY)})`
  const inserts = models.map(
    (model) =>
      `INSERT INTO models (id, name, model, created_at, updated_at) SELECT ${[text(newId()), text(model.name), text(toJson(model)), now, now].join(', ')} WHERE ${notSeeded};`,
  )
  return [...inserts, `INSERT OR IGNORE INTO settings (key, value) VALUES (${text(SEEDED_KEY)}, ${text(String(set))});`, ''].join('\n')
}

/** A SQL string literal. JSON escapes control characters, so quotes are the only thing to double. */
const text = (value: string) => `'${value.replaceAll("'", "''")}'`
