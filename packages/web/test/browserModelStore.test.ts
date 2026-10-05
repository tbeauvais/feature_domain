import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeModelStore } from '../../engine/test/store-contract'
import { BrowserModelStore } from '../src/stores/browserModelStore'
import { MemoryStorage, model, page } from './helpers'

const counterIds = () => {
  let n = 0
  return () => `id-${++n}`
}

describeModelStore('BrowserModelStore', () => new BrowserModelStore(new MemoryStorage(), counterIds()))

describe('BrowserModelStore', () => {
  afterEach(() => vi.restoreAllMocks())

  it('persists models in storage, so another instance (e.g. the preview tab) sees them', async () => {
    const storage = new MemoryStorage()
    const id = await new BrowserModelStore(storage, counterIds()).create({ ...model(page()), name: 'Shared' })
    expect(await new BrowserModelStore(storage).get(id)).toMatchObject({ id, name: 'Shared' })
  })

  it('seeds sample models once, and does not bring back deleted ones', async () => {
    const storage = new MemoryStorage()
    const store = new BrowserModelStore(storage, counterIds())
    await store.seedOnce([{ ...model(page()), name: 'A' }, { ...model(page()), name: 'B' }])
    await store.delete('id-1')
    await store.seedOnce([{ ...model(page()), name: 'A' }])
    expect(await store.list()).toEqual([{ id: 'id-2', name: 'B' }])
  })

  it('treats unreadable storage as empty instead of failing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const storage = new MemoryStorage()
    storage.setItem('feature-domain:models', '{not json')
    expect(await new BrowserModelStore(storage).list()).toEqual([])
    expect(warn).toHaveBeenCalled()
  })

  it('uses window.localStorage and random ids by default', async () => {
    window.localStorage.clear()
    const store = new BrowserModelStore()
    const id = await store.create(model(page()))
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(window.localStorage.getItem('feature-domain:models')).toContain(id)
  })
})
