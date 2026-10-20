import type { AppModel } from './types.js'

export interface ModelSummary {
  id: string
  name: string
  /** When the model was last saved (or created), as an ISO 8601 date and time. */
  updatedAt: string
}

/**
 * A stored model and its revision (how many times it was saved; not the model format's `version`). A new model is
 * revision 1, and every update adds one, so a save can say which revision it was made from (`ifRevision`) and be
 * refused if someone else saved since.
 */
export interface StoredModel {
  model: AppModel
  revision: number
}

/**
 * Persistence for application models. The editor talks only to this interface, so storage can move from the browser
 * to the Cloudflare Worker (D1, KV or Durable Objects) by swapping the implementation.
 */
export interface ModelStore {
  /** Summaries of all stored models, in creation order. */
  list(): Promise<ModelSummary[]>
  /** The model with this id and its revision, or null. */
  get(id: string): Promise<StoredModel | null>
  /** Stores a new model (revision 1) and returns its id (the model's own `id` is ignored). */
  create(model: AppModel): Promise<string>
  /**
   * Replaces a stored model and returns its new revision. Throws `ModelNotFoundError` if it does not exist, and
   * `ModelConflictError` if `ifRevision` is given and is not the stored revision (nothing is changed then). Without
   * `ifRevision`, the update replaces whatever is stored.
   */
  update(id: string, model: AppModel, ifRevision?: number): Promise<number>
  /** Deletes a model. Deleting a missing model is not an error. */
  delete(id: string): Promise<void>
}

/** A store the Worker runs on, which can also store a model under an id of its choosing (the home page's). */
export interface ServerModelStore extends ModelStore {
  /**
   * Stores a model under this id and returns its revision: it replaces the stored model as `update` without
   * `ifRevision` does, or creates it (revision 1) when there is none.
   */
  put(id: string, model: AppModel): Promise<number>
}

export class ModelNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`Model "${id}" does not exist`)
    this.name = 'ModelNotFoundError'
  }
}

/** An update made from an older revision than the one stored: someone else saved the model in between. */
export class ModelConflictError extends Error {
  constructor(
    readonly id: string,
    /** The stored revision. */
    readonly revision: number,
  ) {
    super(`Model "${id}" was changed since it was loaded (it is now revision ${revision})`)
    this.name = 'ModelConflictError'
  }
}

/** Models are stored as JSON, so a stored model never shares objects with the caller. */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** An in-memory store, for tests and as a reference implementation of the contract. */
export class MemoryModelStore implements ServerModelStore {
  private readonly models = new Map<string, StoredModel & { updatedAt: number }>()
  private counter = 0

  constructor(
    private readonly newId: () => string = () => `model-${++this.counter}`,
    private readonly now: () => number = Date.now,
  ) {}

  async list(): Promise<ModelSummary[]> {
    return [...this.models].map(([id, m]) => ({ id, name: m.model.name, updatedAt: new Date(m.updatedAt).toISOString() }))
  }

  async get(id: string): Promise<StoredModel | null> {
    const stored = this.models.get(id)
    return stored ? copy({ model: stored.model, revision: stored.revision }) : null
  }

  async create(model: AppModel): Promise<string> {
    const id = this.newId()
    this.models.set(id, { model: { ...copy(model), id }, revision: 1, updatedAt: this.now() })
    return id
  }

  async update(id: string, model: AppModel, ifRevision?: number): Promise<number> {
    const stored = this.models.get(id)
    if (!stored) throw new ModelNotFoundError(id)
    if (ifRevision !== undefined && ifRevision !== stored.revision) throw new ModelConflictError(id, stored.revision)
    const revision = stored.revision + 1
    this.models.set(id, { model: { ...copy(model), id }, revision, updatedAt: this.now() })
    return revision
  }

  async put(id: string, model: AppModel): Promise<number> {
    const revision = (this.models.get(id)?.revision ?? 0) + 1
    this.models.set(id, { model: { ...copy(model), id }, revision, updatedAt: this.now() })
    return revision
  }

  async delete(id: string): Promise<void> {
    this.models.delete(id)
  }
}
