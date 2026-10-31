// Creating, upgrading and dropping an app's auth tables (spike). Each change is one D1 batch, which D1 runs as one
// transaction, DDL included: the tables and their app_auth row appear (or change) together or not at all. So two
// requests doing the same change at once can't both succeed: the second batch fails (a duplicate key, or a column that
// exists) and rolls back, and reading app_auth again shows the change made.

import { AUTH_SCHEMA_STEPS, authTables, newAuthKey, tablesOf, type AuthSchemaStep } from './tables'

export interface AppAuth {
  key: string
  schemaVersion: number
}

export async function appAuth(db: D1Database, modelId: string): Promise<AppAuth | null> {
  const row = await db.prepare('SELECT key, schema_version FROM app_auth WHERE model_id = ?').bind(modelId).first<{ key: string; schema_version: number }>()
  return row ? { key: row.key, schemaVersion: row.schema_version } : null
}

/**
 * Makes sure the model's app has auth tables at the newest schema version: created when it has none, the missing steps
 * applied when they are older, nothing when current. Never drops anything. Returns the app's key.
 */
export async function ensureAuthTables(db: D1Database, modelId: string, steps: AuthSchemaStep[] = AUTH_SCHEMA_STEPS): Promise<AppAuth> {
  for (let attempt = 0; ; attempt++) {
    const current = await appAuth(db, modelId)
    if (current && current.schemaVersion >= steps.length) return current
    const key = current?.key ?? newAuthKey()
    const from = current?.schemaVersion ?? 0
    const ddl = steps.slice(from).flatMap((step) => step(authTables(key)))
    const record = current
      ? db.prepare('UPDATE app_auth SET schema_version = ? WHERE model_id = ? AND schema_version = ?').bind(steps.length, modelId, from)
      : db.prepare('INSERT INTO app_auth (model_id, key, schema_version) VALUES (?, ?, ?)').bind(modelId, key, steps.length)
    try {
      await db.batch([...ddl.map((sql) => db.prepare(sql)), record])
      return { key, schemaVersion: steps.length }
    } catch (e) {
      // Another request made this change first (its batch committed, so ours rolled back): read again.
      if (attempt >= 2) throw e
    }
  }
}

/** Drops the model's auth tables and their app_auth row (deleting a model). Nothing when it has none. */
export async function dropAuthTables(db: D1Database, modelId: string): Promise<void> {
  const current = await appAuth(db, modelId)
  if (!current) return
  const drops = tablesOf(authTables(current.key)).map((table) => db.prepare(`DROP TABLE IF EXISTS "${table}"`))
  await db.batch([...drops, db.prepare('DELETE FROM app_auth WHERE model_id = ?').bind(modelId)])
}
