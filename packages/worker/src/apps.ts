// Published apps: a model's numbered versions, and the app serving one of them at <slug>.<app domain>.

import type { AppModel } from '@feature-domain/engine'

/** Where a model is published, and which version it serves since when (ISO 8601). */
export interface Publication {
  slug: string
  version: number
  publishedAt: string
}

/** One version of a model as it was published: never changed afterwards. */
export interface AppVersion {
  number: number
  model: AppModel
  publishedAt: string
}

/** A first publish (`publish(…, { first: true })`) found the model already published: another one got there first. */
export class AlreadyPublishedError extends Error {
  constructor(readonly model: string) {
    super(`${model} was published meanwhile`)
    this.name = 'AlreadyPublishedError'
  }
}

/** Another model's app already has this address. */
export class SlugTakenError extends Error {
  constructor(readonly slug: string) {
    super(`"${slug}" is taken`)
    this.name = 'SlugTakenError'
  }
}

export interface AppStore {
  /** The model's app, or null when it isn't published. */
  publication(model: string): Promise<Publication | null>
  /** The app at an address: its model and the number of the version it serves, or null when nothing is published there. */
  bySlug(slug: string): Promise<{ model: string; version: number } | null>
  /** One of the model's versions, or null. Versions never change, so what it gives can be kept. */
  version(model: string, number: number): Promise<AppVersion | null>
  /** The model's newest version, published or not now (unpublished), or null when it never was. */
  latest(model: string): Promise<AppVersion | null>
  /**
   * Stores `app` as the model's next version (1 for the first) and serves it at `slug`, which a model's app can change.
   * Throws `SlugTakenError` (and stores nothing) when another model's app has the slug. With `first`, it must be version
   * 1: when the model has one already (two first publishes at once), it throws `AlreadyPublishedError`, storing nothing.
   */
  publish(model: string, slug: string, app: AppModel, options?: { first?: boolean }): Promise<Publication>
  /** Takes the model's app offline and frees its slug, keeping its versions. Unpublishing twice is not an error. */
  unpublish(model: string): Promise<void>
  /** Deletes the model's app and every version. */
  deleteModel(model: string): Promise<void>
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** An in-memory store, for tests and as the reference implementation of the contract. */
export class MemoryAppStore implements AppStore {
  private readonly versions = new Map<string, AppVersion[]>()
  private readonly apps = new Map<string, Publication>()

  constructor(private readonly now: () => number = Date.now) {}

  async publication(model: string): Promise<Publication | null> {
    const app = this.apps.get(model)
    return app ? { ...app } : null
  }

  async bySlug(slug: string): Promise<{ model: string; version: number } | null> {
    for (const [model, app] of this.apps) if (app.slug === slug) return { model, version: app.version }
    return null
  }

  async version(model: string, number: number): Promise<AppVersion | null> {
    const version = this.versions.get(model)?.find((v) => v.number === number)
    return version ? copy(version) : null
  }

  async latest(model: string): Promise<AppVersion | null> {
    const version = this.versions.get(model)?.at(-1)
    return version ? copy(version) : null
  }

  async publish(model: string, slug: string, app: AppModel, { first = false } = {}): Promise<Publication> {
    const versions = this.versions.get(model) ?? []
    if (first && versions.length > 0) throw new AlreadyPublishedError(model)
    for (const [other, published] of this.apps) if (other !== model && published.slug === slug) throw new SlugTakenError(slug)
    const publishedAt = new Date(this.now()).toISOString()
    const { id: _id, ...stored } = copy(app)
    versions.push({ number: versions.length + 1, model: { ...stored, id: model }, publishedAt })
    this.versions.set(model, versions)
    const publication = { slug, version: versions.length, publishedAt }
    this.apps.set(model, publication)
    return { ...publication }
  }

  async unpublish(model: string): Promise<void> {
    this.apps.delete(model)
  }

  async deleteModel(model: string): Promise<void> {
    this.apps.delete(model)
    this.versions.delete(model)
  }
}
