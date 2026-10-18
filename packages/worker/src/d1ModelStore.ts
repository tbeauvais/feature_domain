import { ModelConflictError, ModelNotFoundError, type AppModel, type ModelStore, type ModelSummary, type VersionedModel } from '@feature-domain/engine'

/**
 * Models in D1 (migrations/), one row each, the model as JSON, with its version. The model's own `id` is not stored in
 * the JSON: the row's id is the only one, and it is put back on read.
 */
export class D1ModelStore implements ModelStore {
  constructor(
    private readonly db: D1Database,
    private readonly newId: () => string = () => crypto.randomUUID(),
    private readonly now: () => number = Date.now,
  ) {}

  async list(): Promise<ModelSummary[]> {
    const { results } = await this.db.prepare('SELECT id, name FROM models ORDER BY created_at, rowid').all<ModelSummary>()
    return results.map(({ id, name }) => ({ id, name }))
  }

  async get(id: string): Promise<VersionedModel | null> {
    const row = await this.db.prepare('SELECT model, version FROM models WHERE id = ?').bind(id).first<{ model: string; version: number }>()
    return row ? { model: { ...(JSON.parse(row.model) as AppModel), id }, version: row.version } : null
  }

  async create(model: AppModel): Promise<string> {
    const id = this.newId()
    const at = this.now()
    await this.db
      .prepare('INSERT INTO models (id, name, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, model.name, toJson(model), at, at)
      .run()
    return id
  }

  async update(id: string, model: AppModel, ifVersion?: number): Promise<number> {
    // One statement checks the version and writes, so no other save can land in between.
    const set = 'UPDATE models SET name = ?, model = ?, updated_at = ?, version = version + 1 WHERE id = ?'
    const statement =
      ifVersion === undefined
        ? this.db.prepare(`${set} RETURNING version`).bind(model.name, toJson(model), this.now(), id)
        : this.db.prepare(`${set} AND version = ? RETURNING version`).bind(model.name, toJson(model), this.now(), id, ifVersion)
    const updated = await statement.first<number>('version')
    if (updated !== null) return updated
    const stored = await this.db.prepare('SELECT version FROM models WHERE id = ?').bind(id).first<number>('version')
    if (stored === null) throw new ModelNotFoundError(id)
    throw new ModelConflictError(id, stored)
  }

  async delete(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM models WHERE id = ?').bind(id).run()
  }
}

/** The stored JSON: the model without its id. */
export function toJson(model: AppModel): string {
  const { id: _id, ...rest } = model
  return JSON.stringify(rest)
}
