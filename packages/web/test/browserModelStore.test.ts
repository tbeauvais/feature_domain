import type { AppModel } from '@feature-domain/engine'
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

  it('upgrades models seeded with older samples once, leaving unrecognised models alone', async () => {
    const storage = new MemoryStorage()
    const store = new BrowserModelStore(storage, counterIds())
    await store.seedOnce([{ ...model(page()), name: 'Old' }, { ...model(page()), name: 'Mine' }])
    const upgrade = vi.fn((m: AppModel) => (m.name === 'Old' ? { ...m, name: 'New' } : m))
    await store.upgradeSeeded(2, upgrade)
    expect(await store.list()).toEqual([
      { id: 'id-1', name: 'New' },
      { id: 'id-2', name: 'Mine' },
    ])
    upgrade.mockClear()
    await store.upgradeSeeded(2, upgrade)
    expect(upgrade).not.toHaveBeenCalled()
  })

  it('never fails the upgrade over a bad model: invalid ones are skipped, a failing upgrade is logged, the rest go on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const storage = new MemoryStorage()
    const store = new BrowserModelStore(storage, counterIds())
    await store.seedOnce([{ ...model(page()), name: 'Broken' }, { ...model(page()), name: 'Throws' }, { ...model(page()), name: 'Old' }])
    const stored = JSON.parse(storage.getItem('feature-domain:models')!)
    stored.models['id-1'].features = [{ id: '1' }]
    storage.setItem('feature-domain:models', JSON.stringify(stored))
    const upgrade = vi.fn((m: AppModel) => {
      if (m.name === 'Throws') throw new Error('boom')
      return m.name === 'Old' ? { ...m, name: 'New' } : m
    })
    await expect(store.upgradeSeeded(2, upgrade)).resolves.toBeUndefined()
    expect(upgrade.mock.calls.map(([m]) => m.name)).toEqual(['Throws', 'Old'])
    expect((await store.list()).map((m) => m.name)).toEqual(['Broken', 'Throws', 'New'])
    expect(warn).toHaveBeenCalledWith('Could not upgrade stored model id-2', expect.any(Error))
    upgrade.mockClear()
    await store.upgradeSeeded(2, upgrade)
    expect(upgrade).not.toHaveBeenCalled()
  })

  it('records the samples version when seeding, so fresh samples are not upgraded again', async () => {
    const store = new BrowserModelStore(new MemoryStorage(), counterIds())
    const upgrade = vi.fn((m: AppModel) => m)
    await store.upgradeSeeded(2, upgrade)
    await store.seedOnce([model(page())], 2)
    await store.upgradeSeeded(2, upgrade)
    expect(upgrade).not.toHaveBeenCalled()
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
