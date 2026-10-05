// The behaviour every ModelStore implementation must have. Each implementation's test file calls
// `describeModelStore` with a factory for a fresh, empty store (packages/web imports this file too).

import { describe, expect, it } from 'vitest'
import { ModelNotFoundError, type AppModel, type ModelStore } from '../src'

const sample = (name: string): AppModel => ({
  version: 2,
  name,
  features: [{ feature: 'PageFeature', id: '1', inputs: { name: 'Page' }, placement: { parent: '$root', slot: 'content' } }],
})

export function describeModelStore(name: string, create: () => ModelStore | Promise<ModelStore>) {
  describe(`${name} (ModelStore contract)`, () => {
    it('starts empty', async () => {
      expect(await (await create()).list()).toEqual([])
    })

    it('creates models with unique ids and lists them in creation order', async () => {
      const store = await create()
      const a = await store.create(sample('A'))
      const b = await store.create(sample('B'))
      expect(a).not.toBe(b)
      expect(await store.list()).toEqual([
        { id: a, name: 'A' },
        { id: b, name: 'B' },
      ])
    })

    it('returns stored models with their id, ignoring any id the caller supplied', async () => {
      const store = await create()
      const id = await store.create({ ...sample('A'), id: 'caller-id' })
      expect(await store.get(id)).toEqual({ ...sample('A'), id })
      expect(await store.get('caller-id')).toBeNull()
    })

    it('returns null for missing models', async () => {
      expect(await (await create()).get('nope')).toBeNull()
    })

    it('updates models', async () => {
      const store = await create()
      const id = await store.create(sample('A'))
      await store.update(id, sample('Renamed'))
      expect(await store.get(id)).toMatchObject({ id, name: 'Renamed' })
      expect(await store.list()).toEqual([{ id, name: 'Renamed' }])
    })

    it('keeps the stored id when an update carries a different one', async () => {
      const store = await create()
      const id = await store.create(sample('A'))
      await store.update(id, { ...sample('B'), id: 'other' })
      expect(await store.get(id)).toMatchObject({ id, name: 'B' })
      expect(await store.get('other')).toBeNull()
      expect(await store.list()).toEqual([{ id, name: 'B' }])
    })

    it('refuses to update missing models', async () => {
      await expect((await create()).update('nope', sample('A'))).rejects.toBeInstanceOf(ModelNotFoundError)
    })

    it('deletes models, and ignores deleting missing ones', async () => {
      const store = await create()
      const id = await store.create(sample('A'))
      await store.delete(id)
      await store.delete('nope')
      expect(await store.get(id)).toBeNull()
      expect(await store.list()).toEqual([])
    })

    it('never shares objects with callers', async () => {
      const store = await create()
      const model = sample('A')
      const id = await store.create(model)
      model.name = 'mutated after create'
      const fetched = (await store.get(id))!
      fetched.features.length = 0
      expect(await store.get(id)).toMatchObject({ name: 'A', features: [{ id: '1' }] })
    })
  })
}
