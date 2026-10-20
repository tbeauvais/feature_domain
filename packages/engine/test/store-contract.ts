// The behavior every ModelStore implementation must have. Each implementation's test file calls
// `describeModelStore` with a factory for a fresh, empty store (packages/web imports this file too).

import { describe, expect, it } from 'vitest'
import { ModelConflictError, ModelNotFoundError, type AppModel, type ModelStore, type ServerModelStore } from '../src'

const sample = (name: string): AppModel => ({
  version: 2,
  name,
  features: [{ feature: 'PageFeature', id: '1', inputs: { name: 'Page' }, placement: { parent: '$root', slot: 'content' } }],
})

/** The listed models without their times, which no test can predict. */
const listed = async (store: ModelStore) => (await store.list()).map(({ id, name }) => ({ id, name }))

export function describeModelStore(name: string, create: () => ModelStore | Promise<ModelStore>) {
  describe(`${name} (ModelStore contract)`, () => {
    it('starts empty', async () => {
      expect(await listed(await create())).toEqual([])
    })

    it('creates models with unique ids and lists them in creation order', async () => {
      const store = await create()
      const a = await store.create(sample('A'))
      const b = await store.create(sample('B'))
      expect(a).not.toBe(b)
      expect(await listed(store)).toEqual([
        { id: a, name: 'A' },
        { id: b, name: 'B' },
      ])
    })

    it('returns stored models with their id, ignoring any id the caller supplied', async () => {
      const store = await create()
      const id = await store.create({ ...sample('A'), id: 'caller-id' })
      expect(await store.get(id)).toEqual({ model: { ...sample('A'), id }, revision: 1 })
      expect(await store.get('caller-id')).toBeNull()
    })

    it('returns null for missing models', async () => {
      expect(await (await create()).get('nope')).toBeNull()
    })

    it('updates models, adding one to the revision each time', async () => {
      const store = await create()
      const id = await store.create(sample('A'))
      expect(await store.update(id, sample('Renamed'))).toBe(2)
      expect(await store.get(id)).toEqual({ model: { ...sample('Renamed'), id }, revision: 2 })
      expect(await listed(store)).toEqual([{ id, name: 'Renamed' }])
      expect(await store.update(id, sample('Again'))).toBe(3)
      expect((await store.get(id))?.revision).toBe(3)
    })

    it('updates a model made from the stored revision', async () => {
      const store = await create()
      const id = await store.create(sample('A'))
      expect(await store.update(id, sample('B'), 1)).toBe(2)
      expect(await store.update(id, sample('C'), 2)).toBe(3)
      expect(await store.get(id)).toMatchObject({ model: { name: 'C' }, revision: 3 })
    })

    it('refuses an update made from an older revision, saying which revision is stored, and changes nothing', async () => {
      const store = await create()
      const id = await store.create(sample('A'))
      await store.update(id, sample('Theirs'), 1)
      const refused = store.update(id, sample('Mine'), 1)
      await expect(refused).rejects.toBeInstanceOf(ModelConflictError)
      await expect(refused).rejects.toMatchObject({ id, revision: 2 })
      expect(await store.get(id)).toMatchObject({ model: { name: 'Theirs' }, revision: 2 })
      expect(await listed(store)).toEqual([{ id, name: 'Theirs' }])
    })

    it('refuses a revision it never had', async () => {
      const store = await create()
      const id = await store.create(sample('A'))
      await expect(store.update(id, sample('B'), 5)).rejects.toMatchObject({ name: 'ModelConflictError', revision: 1 })
    })

    it('keeps the stored id when an update carries a different one', async () => {
      const store = await create()
      const id = await store.create(sample('A'))
      await store.update(id, { ...sample('B'), id: 'other' })
      expect((await store.get(id))?.model).toMatchObject({ id, name: 'B' })
      expect(await store.get('other')).toBeNull()
      expect(await listed(store)).toEqual([{ id, name: 'B' }])
    })

    it('refuses to update missing models', async () => {
      const store = await create()
      await expect(store.update('nope', sample('A'))).rejects.toBeInstanceOf(ModelNotFoundError)
      // Missing is not a conflict, whatever revision the caller had.
      await expect(store.update('nope', sample('A'), 1)).rejects.toBeInstanceOf(ModelNotFoundError)
    })

    it('deletes models, and ignores deleting missing ones', async () => {
      const store = await create()
      const id = await store.create(sample('A'))
      await store.delete(id)
      await store.delete('nope')
      expect(await store.get(id)).toBeNull()
      expect(await listed(store)).toEqual([])
    })

    it('lists when each model was last saved', async () => {
      const store = await create()
      const before = Date.now()
      const id = await store.create(sample('A'))
      const [created] = await store.list()
      expect(created?.updatedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
      expect(Date.parse(created!.updatedAt)).toBeGreaterThanOrEqual(before - 1000)
      await store.update(id, sample('B'))
      const [updated] = await store.list()
      expect(Date.parse(updated!.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created!.updatedAt))
    })

    it('never shares objects with callers', async () => {
      const store = await create()
      const model = sample('A')
      const id = await store.create(model)
      model.name = 'mutated after create'
      const fetched = (await store.get(id))!
      fetched.model.features.length = 0
      fetched.revision = 99
      expect(await store.get(id)).toMatchObject({ model: { name: 'A', features: [{ id: '1' }] }, revision: 1 })
    })
  })
}

/** What a store the Worker runs on does beyond the contract: `put`. */
export function describeServerModelStore(name: string, create: () => ServerModelStore | Promise<ServerModelStore>) {
  describeModelStore(name, create)
  describe(`${name} (ServerModelStore contract)`, () => {
    it('puts a model under a fixed id, creating it at revision 1 and replacing it after', async () => {
      const store = await create()
      expect(await store.put('home', { ...sample('Home'), id: 'other' })).toBe(1)
      expect(await store.get('home')).toEqual({ model: { ...sample('Home'), id: 'home' }, revision: 1 })
      expect(await store.get('other')).toBeNull()
      expect(await store.put('home', sample('Home again'))).toBe(2)
      expect(await store.get('home')).toEqual({ model: { ...sample('Home again'), id: 'home' }, revision: 2 })
      expect(await listed(store)).toEqual([{ id: 'home', name: 'Home again' }])
      // An update made from the revision before the put is refused, as after any other save.
      await expect(store.update('home', sample('Mine'), 1)).rejects.toMatchObject({ name: 'ModelConflictError', revision: 2 })
    })
  })
}
