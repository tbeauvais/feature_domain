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
    expect((await new BrowserModelStore(storage).get(id))?.model).toMatchObject({ id, name: 'Shared' })
  })

  it('seeds sample models once, and does not bring back deleted ones', async () => {
    const storage = new MemoryStorage()
    const store = new BrowserModelStore(storage, counterIds())
    await store.seedOnce([{ ...model(page()), name: 'A' }, { ...model(page()), name: 'B' }])
    await store.delete('id-1')
    await store.seedOnce([{ ...model(page()), name: 'A' }])
    expect(await store.list()).toEqual([{ id: 'id-2', name: 'B' }])
  })

  it('upgrades models seeded with older samples once, leaving unrecognized models alone', async () => {
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

  it('adds a new set of samples once to storage seeded with an older set, keeping the old samples', async () => {
    const storage = new MemoryStorage()
    const store = new BrowserModelStore(storage, counterIds())
    const names = async () => (await store.list()).map((m) => m.name)
    await store.seedOnce([{ ...model(page()), name: 'Old' }])
    await store.addSampleSet([{ ...model(page()), name: 'Guide' }, { ...model(page()), name: 'New' }], 2)
    // At the top, where a fresh browser has its samples.
    expect(await names()).toEqual(['Guide', 'New', 'Old'])
    await store.delete((await store.list()).find((m) => m.name === 'Guide')!.id)
    // Once: deleting a new sample doesn't bring it back.
    await store.delete((await store.list()).find((m) => m.name === 'New')!.id)
    await store.addSampleSet([{ ...model(page()), name: 'New' }], 2)
    expect(await names()).toEqual(['Old'])
  })

  it('never adds a set twice: it is recorded before the models, which go in one write', async () => {
    const storage = new MemoryStorage()
    const store = new BrowserModelStore(storage, counterIds())
    await store.seedOnce([{ ...model(page()), name: 'Old' }])
    // Two tabs starting together: the second sees the set already recorded.
    await Promise.all([store.addSampleSet([{ ...model(page()), name: 'New' }], 2), new BrowserModelStore(storage, counterIds()).addSampleSet([{ ...model(page()), name: 'New' }], 2)])
    expect((await store.list()).map((m) => m.name)).toEqual(['New', 'Old'])
    // Storage full: nothing is added, and the set is not tried again on every start.
    const full = new MemoryStorage()
    const fullStore = new BrowserModelStore(full, counterIds())
    await fullStore.seedOnce([{ ...model(page()), name: 'Old' }])
    vi.spyOn(full, 'setItem').mockImplementation((key, value) => {
      if (key === 'feature-domain:models') throw new DOMException('full', 'QuotaExceededError')
      MemoryStorage.prototype.setItem.call(full, key, value)
    })
    await expect(fullStore.addSampleSet([{ ...model(page()), name: 'New' }], 2)).rejects.toThrow('full')
    vi.restoreAllMocks()
    await fullStore.addSampleSet([{ ...model(page()), name: 'New' }], 2)
    expect((await fullStore.list()).map((m) => m.name)).toEqual(['Old'])
  })

  it('treats an unreadable sample set record as current', async () => {
    const storage = new MemoryStorage()
    const store = new BrowserModelStore(storage, counterIds())
    await store.seedOnce([{ ...model(page()), name: 'Old' }])
    storage.setItem('feature-domain:sample-set', 'garbage')
    await store.addSampleSet([{ ...model(page()), name: 'New' }], 2)
    expect((await store.list()).map((m) => m.name)).toEqual(['Old'])
  })

  it('gives fresh storage the current set only, and never adds a set to storage not yet seeded', async () => {
    const store = new BrowserModelStore(new MemoryStorage(), counterIds())
    await store.addSampleSet([{ ...model(page()), name: 'New' }], 2)
    expect(await store.list()).toEqual([])
    await store.seedOnce([{ ...model(page()), name: 'New' }], 1, 2)
    await store.addSampleSet([{ ...model(page()), name: 'New' }], 2)
    expect((await store.list()).map((m) => m.name)).toEqual(['New'])
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
