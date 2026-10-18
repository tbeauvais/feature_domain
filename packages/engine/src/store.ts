import type { AppModel } from './types.js'

export interface ModelSummary {
  id: string
  name: string
}

/**
 * A stored model and its version. A new model is version 1, and every update adds one, so a save can say which version
 * it was made from (`ifVersion`) and be refused if someone else saved since.
 */
export interface VersionedModel {
  model: AppModel
  version: number
}

/**
 * Persistence for application models. The editor talks only to this interface, so storage can move from the browser
 * to the Cloudflare Worker (D1, KV or Durable Objects) by swapping the implementation.
 */
export interface ModelStore {
  /** Summaries of all stored models, in creation order. */
  list(): Promise<ModelSummary[]>
  /** The model with this id and its version, or null. */
  get(id: string): Promise<VersionedModel | null>
  /** Stores a new model (version 1) and returns its id (the model's own `id` is ignored). */
  create(model: AppModel): Promise<string>
  /**
   * Replaces a stored model and returns its new version. Throws `ModelNotFoundError` if it does not exist, and
   * `ModelConflictError` if `ifVersion` is given and is not the stored version (nothing is changed then). Without
   * `ifVersion`, the update replaces whatever is stored.
   */
  update(id: string, model: AppModel, ifVersion?: number): Promise<number>
  /** Deletes a model. Deleting a missing model is not an error. */
  delete(id: string): Promise<void>
}

export class ModelNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`Model "${id}" does not exist`)
    this.name = 'ModelNotFoundError'
  }
}

/** An update made from an older version than the one stored: someone else saved the model in between. */
export class ModelConflictError extends Error {
  constructor(
    readonly id: string,
    /** The stored version. */
    readonly version: number,
  ) {
    super(`Model "${id}" was changed since it was loaded (it is now version ${version})`)
    this.name = 'ModelConflictError'
  }
}

/** Models are stored as JSON, so a stored model never shares objects with the caller. */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** An in-memory store, for tests and as a reference implementation of the contract. */
export class MemoryModelStore implements ModelStore {
  private readonly models = new Map<string, VersionedModel>()
  private counter = 0

  constructor(private readonly newId: () => string = () => `model-${++this.counter}`) {}

  async list(): Promise<ModelSummary[]> {
    return [...this.models].map(([id, m]) => ({ id, name: m.model.name }))
  }

  async get(id: string): Promise<VersionedModel | null> {
    const stored = this.models.get(id)
    return stored ? copy(stored) : null
  }

  async create(model: AppModel): Promise<string> {
    const id = this.newId()
    this.models.set(id, { model: { ...copy(model), id }, version: 1 })
    return id
  }

  async update(id: string, model: AppModel, ifVersion?: number): Promise<number> {
    const stored = this.models.get(id)
    if (!stored) throw new ModelNotFoundError(id)
    if (ifVersion !== undefined && ifVersion !== stored.version) throw new ModelConflictError(id, stored.version)
    const version = stored.version + 1
    this.models.set(id, { model: { ...copy(model), id }, version })
    return version
  }

  async delete(id: string): Promise<void> {
    this.models.delete(id)
  }
}
