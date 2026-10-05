import { ModelNotFoundError, type AppModel, type ModelStore, type ModelSummary } from '@feature-domain/engine'

const MODELS_KEY = 'feature-domain:models'
const SEEDED_KEY = 'feature-domain:seeded'

interface Stored {
  order: string[]
  models: Record<string, AppModel>
}

/**
 * Stores models in the browser (localStorage by default) until the backend exists. Implements the same `ModelStore`
 * interface the Cloudflare Worker will, so the editor does not change when storage moves.
 */
export class BrowserModelStore implements ModelStore {
  constructor(
    private readonly storage: Storage = window.localStorage,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  async list(): Promise<ModelSummary[]> {
    const { order, models } = this.read()
    return order.flatMap((id) => (models[id] ? [{ id, name: models[id].name }] : []))
  }

  async get(id: string): Promise<AppModel | null> {
    return this.read().models[id] ?? null
  }

  async create(model: AppModel): Promise<string> {
    const stored = this.read()
    const id = this.newId()
    stored.models[id] = { ...model, id }
    stored.order.push(id)
    this.write(stored)
    return id
  }

  async update(id: string, model: AppModel): Promise<void> {
    const stored = this.read()
    if (!stored.models[id]) throw new ModelNotFoundError(id)
    stored.models[id] = { ...model, id }
    this.write(stored)
  }

  async delete(id: string): Promise<void> {
    const stored = this.read()
    delete stored.models[id]
    stored.order = stored.order.filter((o) => o !== id)
    this.write(stored)
  }

  /**
   * Adds `models` the first time this storage is used. Runs once: models the user deletes later do not come back.
   */
  async seedOnce(models: AppModel[]): Promise<void> {
    if (this.storage.getItem(SEEDED_KEY) !== null) return
    for (const model of models) await this.create(model)
    this.storage.setItem(SEEDED_KEY, new Date().toISOString())
  }

  // Every call re-reads storage, so the editor and preview tabs always see each other's saves. Parsing also means
  // callers never share objects with what is stored.
  private read(): Stored {
    const raw = this.storage.getItem(MODELS_KEY)
    if (raw === null) return { order: [], models: {} }
    try {
      const parsed = JSON.parse(raw) as Partial<Stored>
      if (Array.isArray(parsed.order) && typeof parsed.models === 'object' && parsed.models !== null) return parsed as Stored
    } catch {
      // fall through
    }
    console.warn(`Ignoring unreadable ${MODELS_KEY} in browser storage`)
    return { order: [], models: {} }
  }

  private write(stored: Stored): void {
    this.storage.setItem(MODELS_KEY, JSON.stringify(stored))
  }
}
