import type { AppModel } from './types.js'

export interface ModelSummary {
  id: string
  name: string
}

/**
 * Persistence for application models. The editor talks only to this interface, so storage can move from the browser
 * to the Cloudflare Worker (D1, KV or Durable Objects) by swapping the implementation.
 */
export interface ModelStore {
  /** Summaries of all stored models, in creation order. */
  list(): Promise<ModelSummary[]>
  /** The model with this id, or null. */
  get(id: string): Promise<AppModel | null>
  /** Stores a new model and returns its id (the model's own `id` is ignored). */
  create(model: AppModel): Promise<string>
  /** Replaces a stored model. Throws if it does not exist. */
  update(id: string, model: AppModel): Promise<void>
  /** Deletes a model. Deleting a missing model is not an error. */
  delete(id: string): Promise<void>
}

export class ModelNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`Model "${id}" does not exist`)
    this.name = 'ModelNotFoundError'
  }
}

/** Models are stored as JSON, so a stored model never shares objects with the caller. */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** An in-memory store, for tests and as a reference implementation of the contract. */
export class MemoryModelStore implements ModelStore {
  private readonly models = new Map<string, AppModel>()
  private counter = 0

  constructor(private readonly newId: () => string = () => `model-${++this.counter}`) {}

  async list(): Promise<ModelSummary[]> {
    return [...this.models].map(([id, m]) => ({ id, name: m.name }))
  }

  async get(id: string): Promise<AppModel | null> {
    const model = this.models.get(id)
    return model ? copy(model) : null
  }

  async create(model: AppModel): Promise<string> {
    const id = this.newId()
    this.models.set(id, { ...copy(model), id })
    return id
  }

  async update(id: string, model: AppModel): Promise<void> {
    if (!this.models.has(id)) throw new ModelNotFoundError(id)
    this.models.set(id, { ...copy(model), id })
  }

  async delete(id: string): Promise<void> {
    this.models.delete(id)
  }
}
