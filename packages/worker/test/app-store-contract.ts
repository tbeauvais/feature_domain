// The behavior every AppStore implementation must have. Each implementation's test file calls `describeAppStore` with a
// factory for a fresh, empty store.

import type { AppModel } from '@feature-domain/engine'
import { describe, expect, it } from 'vitest'
import { AlreadyPublishedError, SlugTakenError, type AppStore } from '../src/apps'

const model = (name: string): AppModel => ({ version: 2, name, features: [] })

export function describeAppStore(name: string, create: () => AppStore | Promise<AppStore>) {
  describe(`${name} (AppStore contract)`, () => {
    it('starts with nothing published', async () => {
      const store = await create()
      expect(await store.publication('m1')).toBeNull()
      expect(await store.latest('m1')).toBeNull()
      expect(await store.bySlug('requests')).toBeNull()
    })

    it('numbers versions from 1, and serves the newest at its slug', async () => {
      const store = await create()
      const first = await store.publish('m1', 'requests', model('First'))
      expect(first).toEqual({ slug: 'requests', version: 1, publishedAt: expect.any(String) })
      expect(new Date(first.publishedAt).toISOString()).toBe(first.publishedAt)
      const second = await store.publish('m1', 'requests', model('Second'))
      expect(second.version).toBe(2)
      expect(await store.publication('m1')).toEqual(second)
      // The model's id is its own, whatever the published model said.
      expect(await store.bySlug('requests')).toEqual({ model: 'm1', version: 2 })
      expect(await store.version('m1', 2)).toEqual({ number: 2, model: { ...model('Second'), id: 'm1' }, publishedAt: second.publishedAt })
      expect((await store.version('m1', 1))?.model.name).toBe('First')
      expect(await store.version('m1', 3)).toBeNull()
      expect(await store.version('m2', 1)).toBeNull()
      expect((await store.latest('m1'))?.model.name).toBe('Second')
    })

    it('stores the model given, which the caller can change afterwards', async () => {
      const store = await create()
      const app = { ...model('Kept'), id: 'other' }
      await store.publish('m1', 'kept', app)
      app.name = 'Changed'
      const served = await store.version('m1', 1)
      expect(served?.model).toEqual({ ...model('Kept'), id: 'm1' })
      served!.model.name = 'Changed too'
      expect((await store.latest('m1'))?.model.name).toBe('Kept')
    })

    it('moves an app to a new slug, freeing the old one', async () => {
      const store = await create()
      await store.publish('m1', 'requests', model('A'))
      await store.publish('m1', 'team-requests', model('A'))
      expect(await store.bySlug('requests')).toBeNull()
      expect((await store.bySlug('team-requests'))?.model).toBe('m1')
      await store.publish('m2', 'requests', model('B'))
      expect((await store.bySlug('requests'))?.model).toBe('m2')
    })

    it("refuses another model's slug, storing nothing", async () => {
      const store = await create()
      await store.publish('m1', 'requests', model('A'))
      await expect(store.publish('m2', 'requests', model('B'))).rejects.toThrow(SlugTakenError)
      expect(await store.latest('m2')).toBeNull()
      expect(await store.publication('m2')).toBeNull()
      await store.publish('m2', 'other', model('B'))
      await expect(store.publish('m2', 'requests', model('B'))).rejects.toThrow(SlugTakenError)
      expect(await store.publication('m2')).toMatchObject({ slug: 'other', version: 1 })
      expect((await store.bySlug('requests'))?.model).toBe('m1')
    })

    it('publishes a first version only once, for two first publishes at once', async () => {
      const store = await create()
      const results = await Promise.allSettled([
        store.publish('m1', 'requests', model('A'), { first: true }),
        store.publish('m1', 'requests', model('B'), { first: true }),
      ])
      expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
      expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(AlreadyPublishedError)
      expect(await store.publication('m1')).toMatchObject({ version: 1 })
      // Once published (or unpublished), a first publish is refused, and stores nothing.
      await store.unpublish('m1')
      await expect(store.publish('m1', 'other', model('C'), { first: true })).rejects.toThrow(AlreadyPublishedError)
      expect(await store.publication('m1')).toBeNull()
      expect((await store.latest('m1'))?.number).toBe(1)
    })

    it('unpublishes: the app goes and its slug is free, but its versions stay and count on', async () => {
      const store = await create()
      await store.publish('m1', 'requests', model('A'))
      await store.unpublish('m1')
      await store.unpublish('m1')
      expect(await store.publication('m1')).toBeNull()
      expect(await store.bySlug('requests')).toBeNull()
      expect((await store.latest('m1'))?.number).toBe(1)
      await store.publish('m2', 'requests', model('B'))
      expect(await store.publish('m1', 'requests-2', model('A again'))).toMatchObject({ version: 2 })
    })

    it("deletes a model's app and versions, leaving other models'", async () => {
      const store = await create()
      await store.publish('m1', 'requests', model('A'))
      await store.publish('m2', 'other', model('B'))
      await store.deleteModel('m1')
      expect(await store.latest('m1')).toBeNull()
      expect(await store.bySlug('requests')).toBeNull()
      expect(await store.publish('m1', 'requests', model('Again'))).toMatchObject({ version: 1 })
      expect((await store.bySlug('other'))?.model).toBe('m2')
    })
  })
}
