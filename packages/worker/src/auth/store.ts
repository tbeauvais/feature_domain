// Each published app with sign-in has Better Auth tables of its own (src/auth/tables.ts). This creates, upgrades and
// drops them. Every change is one D1 batch, which D1 runs as one transaction, DDL included: an app's tables and its
// app_auth row appear (or change) together or not at all. So two requests making the same change at once can't both
// succeed: the second batch fails (a duplicate key, or a column that exists), rolls back, and reading app_auth again
// shows the change made. Never more than one app per batch: schema changes get slow as the database holds more tables
// (packages/worker/spike/FINDINGS.md), and on Cloudflare a batch of 50 DROP TABLEs at 15,000 tables hit D1's CPU limit.

import { AUTH_SCHEMA_STEPS, authTables, isAuthKey, newAuthKey, tablesOf, type AuthSchemaStep } from './tables'

/** An app's auth tables: their key, and the schema version they are at. */
export interface AppAuth {
  key: string
  schemaVersion: number
}

/** What `upgradeAll` did. */
export interface UpgradeReport {
  /** Models whose tables were brought up to date. */
  upgraded: string[]
  /** Models whose tables were dropped because the model is gone. */
  dropped: string[]
  /** Keys of tables no app_auth row names, dropped. */
  orphans: string[]
}

const ORPHAN_TABLE = /^app_([0-9a-f]{32})_/

/** Which apps have auth tables, and making or dropping them (what publishing and deleting a model use). */
export interface AuthTables {
  get(modelId: string): Promise<AppAuth | null>
  /** Creates the model's auth tables, or brings them up to date; never drops anything. */
  ensure(modelId: string): Promise<AppAuth>
  /** Brings the model's auth tables up to date, never creating them: null when it has none (dropped meanwhile). */
  upgrade(modelId: string): Promise<AppAuth | null>
  /** Drops the model's auth tables. Nothing when it has none. */
  drop(modelId: string): Promise<void>
}

/** Keeps only the record of which apps have auth tables, for the web tests' in-process API (no D1 there). */
export class MemoryAuthTables implements AuthTables {
  private readonly apps = new Map<string, AppAuth>()
  constructor(private readonly schemaVersion = AUTH_SCHEMA_STEPS.length) {}
  async get(modelId: string) {
    return this.apps.get(modelId) ?? null
  }
  async ensure(modelId: string) {
    const current = this.apps.get(modelId)
    if (current && current.schemaVersion >= this.schemaVersion) return current
    const app = { key: current?.key ?? newAuthKey(), schemaVersion: this.schemaVersion }
    this.apps.set(modelId, app)
    return app
  }
  async upgrade(modelId: string) {
    return this.apps.has(modelId) ? this.ensure(modelId) : null
  }
  async drop(modelId: string) {
    this.apps.delete(modelId)
  }
}

export class D1AuthTables implements AuthTables {
  constructor(
    private readonly db: D1Database,
    private readonly steps: AuthSchemaStep[] = AUTH_SCHEMA_STEPS,
  ) {}

  async get(modelId: string): Promise<AppAuth | null> {
    const row = await this.db
      .prepare('SELECT key, schema_version FROM app_auth WHERE model_id = ?')
      .bind(modelId)
      .first<{ key: string; schema_version: number }>()
    return row ? { key: row.key, schemaVersion: row.schema_version } : null
  }

  /**
   * Makes sure the model's app has auth tables at the newest schema version: created when it has none, the missing steps
   * applied when they are older, nothing when current. Never drops anything.
   */
  async ensure(modelId: string): Promise<AppAuth> {
    return (await this.change(modelId, true))!
  }

  async upgrade(modelId: string): Promise<AppAuth | null> {
    return this.change(modelId, false)
  }

  /** `ensure`, or with `create` false `upgrade`: an app without tables (dropped meanwhile) stays without them. */
  private async change(modelId: string, create: boolean): Promise<AppAuth | null> {
    const newest = this.steps.length
    let current = await this.get(modelId)
    for (let attempt = 0; ; attempt++) {
      if (!current && !create) return null
      if (current && current.schemaVersion >= newest) return current
      const key = current?.key ?? newAuthKey()
      const from = current?.schemaVersion ?? 0
      const ddl = this.steps.slice(from).flatMap((step) => step(authTables(key)).map((sql) => this.db.prepare(sql)))
      // The record goes first, so the DDL runs only once it holds. An upgrade's UPDATE names the key and version it read;
      // should the row have changed since (dropped, upgraded by another request, or dropped and made again under a new
      // key), the next statement fails the batch (a NULL key), so none of it is kept: no tables are added for an app that
      // has none or under a key no longer its own, nor steps applied twice.
      const record = current
        ? [
            this.db.prepare('UPDATE app_auth SET schema_version = ? WHERE model_id = ? AND key = ? AND schema_version = ?').bind(newest, modelId, key, from),
            this.db.prepare('INSERT INTO app_auth (model_id, key, schema_version) SELECT NULL, NULL, NULL WHERE changes() = 0'),
          ]
        : [this.db.prepare('INSERT INTO app_auth (model_id, key, schema_version) VALUES (?, ?, ?)').bind(modelId, key, newest)]
      try {
        await this.db.batch([...record, ...ddl])
        return { key, schemaVersion: newest }
      } catch (e) {
        // Retried only when another request changed the record meanwhile (its batch committed, so ours rolled back).
        // Anything else (a failing step, D1's limits) is thrown at once: running the same batch again wouldn't help.
        const now = await this.get(modelId)
        if (attempt >= 2 || (now?.key === current?.key && now?.schemaVersion === current?.schemaVersion)) throw e
        current = now
      }
    }
  }

  /** Drops the model's auth tables and their app_auth row. Nothing when it has none. */
  async drop(modelId: string): Promise<void> {
    const current = await this.get(modelId)
    if (current) await this.dropKey(current.key, modelId)
  }

  /**
   * Brings every app's tables up to date, drops those of models that are gone, and drops tables no app_auth row names
   * (none should exist: tables and row are made in one batch). One app at a time.
   */
  async upgradeAll(): Promise<UpgradeReport> {
    const report: UpgradeReport = { upgraded: [], dropped: [], orphans: [] }
    const apps = (
      await this.db
        .prepare('SELECT a.model_id, a.key, a.schema_version, m.id IS NOT NULL AS live FROM app_auth a LEFT JOIN models m ON m.id = a.model_id')
        .all<{ model_id: string; key: string; schema_version: number; live: number }>()
    ).results
    for (const app of apps) {
      if (!app.live) {
        await this.dropKey(app.key, app.model_id)
        report.dropped.push(app.model_id)
      } else if (app.schema_version < this.steps.length) {
        await this.ensure(app.model_id)
        report.upgraded.push(app.model_id)
      }
    }
    const named = new Set(apps.map((app) => app.key))
    const tables = (await this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'app\\_%' ESCAPE '\\'").all<{ name: string }>())
      .results
    const orphans = new Set(tables.map((t) => ORPHAN_TABLE.exec(t.name)?.[1]).filter((key): key is string => isAuthKey(key) && !named.has(key)))
    for (const key of orphans) {
      // Made since the read above, with its row (a publish): not an orphan.
      if (await this.db.prepare('SELECT 1 FROM app_auth WHERE key = ?').bind(key).first()) continue
      await this.dropKey(key)
      report.orphans.push(key)
    }
    return report
  }

  /**
   * Drops one key's tables, and the model's record only while it still names that key: one made again under a new key
   * since it was read (a publish, meanwhile) keeps its record and tables.
   */
  private async dropKey(key: string, modelId?: string): Promise<void> {
    const drops = tablesOf(authTables(key)).map((table) => this.db.prepare(`DROP TABLE IF EXISTS "${table}"`))
    const forget = modelId === undefined ? [] : [this.db.prepare('DELETE FROM app_auth WHERE model_id = ? AND key = ?').bind(modelId, key)]
    await this.db.batch([...drops, ...forget])
  }
}
