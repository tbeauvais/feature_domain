import { MemoryModelStore } from '@feature-domain/engine'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { setModelStore } from '../src/services'
import { useDocumentStore } from '../src/stores/document'
import { model, page } from './helpers'

// The engine never throws for valid models; this guards the editor against a future engine bug anyway.
vi.mock('@feature-domain/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@feature-domain/engine')>()),
  generate: () => {
    throw new Error('engine bug')
  },
}))

describe('useDocumentStore when generation fails', () => {
  it('reports the failure instead of throwing from the computed result', async () => {
    setActivePinia(createPinia())
    const store = new MemoryModelStore()
    setModelStore(store)
    const doc = useDocumentStore()
    await doc.load(await store.create(model(page())))
    expect(doc.status).toBe('ready')
    expect(doc.result).toBeNull()
    expect(doc.generateError).toBe('engine bug')
  })
})
