import type { AppModel } from '@feature-domain/engine'
import { AlreadyPublishedError, SlugTakenError, type AppStore, type AppVersion, type Publication } from './apps'
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
 * Published apps in D1 (migrations/0004_apps.sql). A version's JSON leaves out the model's id, as models' does; it is put
 * back on read.
 */
export class D1AppStore implements AppStore {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => number = Date.now,
  ) {}

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

  async publish(model: string, slug: string, app: AppModel, { first = false } = {}): Promise<Publication> {
    const at = this.now()
    const newest = '(SELECT max(number) FROM versions WHERE model_id = ?)'
    try {
      // One batch (a transaction): the next version, then the app pointed at it. A slug another app has fails the
      // UNIQUE constraint, and the whole batch with it; so does a first publish's version 1 when the model has one.
      const version = first
        ? this.db.prepare('INSERT INTO versions (model_id, number, model, published_at) VALUES (?, 1, ?, ?)').bind(model, toJson(app), at)
        : this.db
            .prepare(
              'INSERT INTO versions (model_id, number, model, published_at) SELECT ?, coalesce(max(number), 0) + 1, ?, ? FROM versions WHERE model_id = ?',
            )
            .bind(model, toJson(app), at, model)
      const results = await this.db.batch<{ slug: string; version: number; published_at: number }>([
        version,
        this.db.prepare(`UPDATE apps SET slug = ?, version = ${newest}, published_at = ? WHERE model_id = ?`).bind(slug, model, at, model),
        this.db
          .prepare(
            `INSERT INTO apps (model_id, slug, version, published_at) SELECT ?, ?, ${newest}, ? WHERE NOT EXISTS (SELECT 1 FROM apps WHERE model_id = ?)`,
          )
          .bind(model, slug, model, at, model),
        this.db.prepare('SELECT slug, version, published_at FROM apps WHERE model_id = ?').bind(model),
      ])
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
