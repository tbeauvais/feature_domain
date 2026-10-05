import { MemoryModelStore, type ModelStore } from '@feature-domain/engine'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { setModelStore } from '../src/services'
import { useDocumentStore } from '../src/stores/document'
import { inst, model, page } from './helpers'

describe('useDocumentStore', () => {
  let store: MemoryModelStore
  beforeEach(() => {
    setActivePinia(createPinia())
    store = new MemoryModelStore()
    setModelStore(store)
  })

  it('loads a model and generates its document', async () => {
    const id = await store.create(model(page(), inst('TextFeature', 't', { text: 'hi' })))
    const doc = useDocumentStore()
    await doc.load(id)
    expect(doc.status).toBe('ready')
    expect(doc.model?.id).toBe(id)
    expect(doc.result?.root.children[0]?.children[0]?.props).toEqual({ text: 'hi' })
  })

  it('reports missing models and storage errors', async () => {
    const doc = useDocumentStore()
    await doc.load('nope')
    expect(doc.status).toBe('missing')
    expect(doc.result).toBeNull()

    setModelStore({ get: async () => { throw new Error('quota exceeded') } } as unknown as ModelStore)
    await doc.load('x')
    expect(doc.status).toBe('error')
    expect(doc.error).toBe('quota exceeded')
  })

  it('refuses models that are not structurally valid, instead of failing to generate them', async () => {
    setModelStore({ get: async () => ({ version: 2, name: 'Malformed' }) } as unknown as ModelStore)
    const doc = useDocumentStore()
    await doc.load('malformed')
    expect(doc.status).toBe('error')
    expect(doc.error).toBe('the model is not valid (Model has no features list)')
    expect(doc.model).toBeNull()
    expect(doc.result).toBeNull()
  })

  it('summarizes long lists of problems', async () => {
    setModelStore({ get: async () => ({ version: 2, name: 'x', features: [1, 2, 3, 4, 5] }) } as unknown as ModelStore)
    const doc = useDocumentStore()
    await doc.load('m')
    expect(doc.error).toBe('the model is not valid (Feature 0 is not an object; Feature 1 is not an object; Feature 2 is not an object; 2 more)')
  })

  it('ignores a slow load that a newer load overtook', async () => {
    const first = await store.create({ ...model(page()), name: 'First' })
    const second = await store.create({ ...model(page()), name: 'Second' })
    const doc = useDocumentStore()
    const slow = doc.load(first)
    await doc.load(second)
    await slow
    expect(doc.model?.name).toBe('Second')
  })
})
