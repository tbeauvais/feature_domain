import type { AppModel } from '@feature-domain/engine'
import { AlreadyPublishedError, ClaimLostError, PUBLISHING_CLAIM_MS, SlugTakenError, type AppStore, type AppVersion, type Publication } from './apps'
import { toJson } from './d1ModelStore'

interface VersionRecord {
  number: number
  model: string
  published_at: number
}

const toVersion = (id: string, r: VersionRecord): AppVersion => ({
  number: r.number,
  model: { ...(JSON.parse(r.model) as AppModel), id },
  publishedAt: new Date(r.published_at).toISOString(),
})

/**
 * Published apps in D1 (migrations/0004_apps.sql, and 0005_publishing.sql for claims). A version's JSON leaves out the model's id, as models' does; it is put
 * back on read.
 */
export class D1AppStore implements AppStore {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => number = Date.now,
  ) {}

  async claim(model: string): Promise<string | null> {
    const token = crypto.randomUUID()
    const at = this.now()
    // One statement: a new claim, or one taking over a claim that is too old; else no row comes back.
    const row = await this.db
      .prepare(
        'INSERT INTO publishing (model_id, token, since) VALUES (?, ?, ?) ON CONFLICT (model_id) DO UPDATE SET token = excluded.token, since = excluded.since WHERE publishing.since <= ? RETURNING token',
      )
      .bind(model, token, at, at - PUBLISHING_CLAIM_MS)
      .first<{ token: string }>()
    return row?.token === token ? token : null
  }

  async release(model: string, token: string): Promise<void> {
    await this.db.prepare('DELETE FROM publishing WHERE model_id = ? AND token = ?').bind(model, token).run()
  }

  async publication(model: string): Promise<Publication | null> {
    const row = await this.db
      .prepare('SELECT slug, version, published_at FROM apps WHERE model_id = ?')
      .bind(model)
      .first<{ slug: string; version: number; published_at: number }>()
    return row ? { slug: row.slug, version: row.version, publishedAt: new Date(row.published_at).toISOString() } : null
  }

  async bySlug(slug: string): Promise<{ model: string; version: number } | null> {
    const row = await this.db.prepare('SELECT model_id, version FROM apps WHERE slug = ?').bind(slug).first<{ model_id: string; version: number }>()
    return row ? { model: row.model_id, version: row.version } : null
  }

  async version(model: string, number: number): Promise<AppVersion | null> {
    const row = await this.db
      .prepare('SELECT number, model, published_at FROM versions WHERE model_id = ? AND number = ?')
      .bind(model, number)
      .first<VersionRecord>()
    return row ? toVersion(model, row) : null
  }

  async latest(model: string): Promise<AppVersion | null> {
    const row = await this.db
      .prepare('SELECT number, model, published_at FROM versions WHERE model_id = ? ORDER BY number DESC LIMIT 1')
      .bind(model)
      .first<VersionRecord>()
    return row ? toVersion(model, row) : null
  }

  async publish(model: string, slug: string, app: AppModel, { first = false, claim }: { first?: boolean; claim?: string } = {}): Promise<Publication> {
    const at = this.now()
    const newest = '(SELECT max(number) FROM versions WHERE model_id = ?)'
    // With a claim, each write happens only while it holds (`held`, bound to the model and token after the others).
    const held = claim === undefined ? '1' : 'EXISTS (SELECT 1 FROM publishing WHERE model_id = ? AND token = ?)'
    const holding = claim === undefined ? [] : [model, claim]
    try {
      // One batch (a transaction): the next version, then the app pointed at it. A slug another app has fails the
      // UNIQUE constraint, and the whole batch with it; so does a first publish's version 1 when the model has one.
      const version = first
        ? this.db
            .prepare(`INSERT INTO versions (model_id, number, model, published_at) SELECT ?, 1, ?, ? WHERE ${held}`)
            .bind(model, toJson(app), at, ...holding)
        : this.db
            .prepare(`INSERT INTO versions (model_id, number, model, published_at) SELECT ?, coalesce(${newest}, 0) + 1, ?, ? WHERE ${held}`)
            .bind(model, model, toJson(app), at, ...holding)
      const results = await this.db.batch<{ slug: string; version: number; published_at: number }>([
        version,
        this.db
          .prepare(`UPDATE apps SET slug = ?, version = ${newest}, published_at = ? WHERE model_id = ? AND ${held}`)
          .bind(slug, model, at, model, ...holding),
        this.db
          .prepare(
            `INSERT INTO apps (model_id, slug, version, published_at) SELECT ?, ?, ${newest}, ? WHERE NOT EXISTS (SELECT 1 FROM apps WHERE model_id = ?) AND ${held}`,
          )
          .bind(model, slug, model, at, model, ...holding),
        this.db.prepare('SELECT slug, version, published_at FROM apps WHERE model_id = ?').bind(model),
      ])
      if (results[0]!.meta.changes === 0) throw new ClaimLostError(model)
      const row = results[3]!.results[0]!
      return { slug: row.slug, version: row.version, publishedAt: new Date(row.published_at).toISOString() }
    } catch (e) {
      if (e instanceof Error && /UNIQUE constraint failed: apps\.slug/.test(e.message)) throw new SlugTakenError(slug)
      if (e instanceof Error && /UNIQUE constraint failed: versions\./.test(e.message)) throw new AlreadyPublishedError(model)
      throw e
    }
  }

  async unpublish(model: string): Promise<void> {
    await this.db.prepare('DELETE FROM apps WHERE model_id = ?').bind(model).run()
  }

  async deleteModel(model: string): Promise<void> {
    await this.db.batch([
      this.db.prepare('DELETE FROM apps WHERE model_id = ?').bind(model),
      this.db.prepare('DELETE FROM versions WHERE model_id = ?').bind(model),
    ])
  }
}
