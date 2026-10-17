import { ModelNotFoundError, type AppModel, type ModelStore, type ModelSummary } from '@feature-domain/engine'

/**
 * Models in D1 (migrations/0001_models.sql), one row each, the model as JSON. The model's own `id` is not stored in
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

  async get(id: string): Promise<AppModel | null> {
    const row = await this.db.prepare('SELECT model FROM models WHERE id = ?').bind(id).first<{ model: string }>()
    return row ? { ...(JSON.parse(row.model) as AppModel), id } : null
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

  async update(id: string, model: AppModel): Promise<void> {
    const { meta } = await this.db
      .prepare('UPDATE models SET name = ?, model = ?, updated_at = ? WHERE id = ?')
      .bind(model.name, toJson(model), this.now(), id)
      .run()
    if (meta.changes === 0) throw new ModelNotFoundError(id)
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
