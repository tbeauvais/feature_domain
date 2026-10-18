import { MemoryModelStore, ModelConflictError, type AppModel } from '@feature-domain/engine'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setModelStore } from '../src/services'
import { KEEPALIVE_MAX_BYTES } from '../src/stores/apiModelStore'
import { SAVE_DELAY_MS, useDocumentStore } from '../src/stores/document'
import { SignedOutError } from '../src/stores/apiModelStore'
import { TAB_ID } from '../src/stores/modelChannel'
import { inst, model, page } from './helpers'

// Saving through a store with revisions: one save at a time, conflicts and deleted models held for the user.

/** A promise and the functions that settle it. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}

describe('saving with revisions', () => {
  let store: MemoryModelStore
  let id: string

  async function open(m: AppModel = model(page())) {
    id = await store.create(m)
    const doc = useDocumentStore()
    doc.editing = true
    await doc.load(id)
    return doc
  }
  const stored = async () => (await store.get(id))!

  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    store = new MemoryModelStore()
    setModelStore(store)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('sends each save with the revision the last one returned', async () => {
    const doc = await open()
    const update = vi.spyOn(store, 'update')
    doc.rename('A')
    await doc.flush()
    doc.rename('B')
    await doc.flush()
    expect(update.mock.calls.map((c) => c[2])).toEqual([1, 2])
    expect(await stored()).toMatchObject({ model: { name: 'B' }, revision: 3 })
    expect(doc.saveState).toBe('saved')
  })

  it('saves one at a time: an edit made during a save goes after it, made from its revision, never as a conflict', async () => {
    const doc = await open()
    const real = store.update.bind(store)
    const first = deferred<void>()
    const update = vi.spyOn(store, 'update').mockImplementationOnce(async (...args) => {
      await first.promise
      return real(...args)
    })
    doc.rename('First')
    vi.advanceTimersByTime(SAVE_DELAY_MS)
    expect(doc.saveState).toBe('saving')
    doc.rename('Second')
    // flush() doesn't start a second save beside the one in flight: it waits, then saves the newest model.
    const flushed = doc.flush()
    expect(update).toHaveBeenCalledTimes(1)
    first.resolve()
    expect(await flushed).toBe(true)
    expect(update.mock.calls.map((c) => [c[1].name, c[2]])).toEqual([
      ['First', 1],
      ['Second', 2],
    ])
    expect(doc.saveState).toBe('saved')
    expect(await stored()).toMatchObject({ model: { name: 'Second' }, revision: 3 })
  })

  it('holds a conflict for the user, saving nothing until they choose', async () => {
    const doc = await open()
    await store.update(id, { ...model(page()), name: 'Theirs' })
    doc.rename('Mine')
    expect(await doc.flush()).toBe(false)
    expect(doc.saveState).toBe('conflict')
    expect(doc.saveError).toBe('someone else saved this model since you opened it')
    const update = vi.spyOn(store, 'update')
    doc.rename('Mine, again')
    vi.advanceTimersByTime(SAVE_DELAY_MS * 2)
    expect(update).not.toHaveBeenCalled()
    expect(doc.saveState).toBe('conflict')
    expect(doc.unsavedOnLeave()).toBe(true)
  })

  it('keeps mine: saves over their revision', async () => {
    const doc = await open()
    await store.update(id, { ...model(page()), name: 'Theirs' })
    doc.rename('Mine')
    await doc.flush()
    await doc.keepMine()
    expect(doc.saveState).toBe('saved')
    expect(await stored()).toMatchObject({ model: { name: 'Mine' }, revision: 3 })
    // Saving goes on from there.
    doc.rename('Mine 2')
    expect(await doc.flush()).toBe(true)
    expect((await stored()).revision).toBe(4)
  })

  it('keeps mine again when they saved once more meanwhile', async () => {
    const doc = await open()
    await store.update(id, { ...model(page()), name: 'Theirs' })
    doc.rename('Mine')
    await doc.flush()
    await store.update(id, { ...model(page()), name: 'Theirs again' })
    await doc.keepMine()
    expect(doc.saveState).toBe('conflict')
    await doc.keepMine()
    expect(doc.saveState).toBe('saved')
    expect((await stored()).model.name).toBe('Mine')
  })

  it('loads theirs: drops the edits made here, and their undo history', async () => {
    const doc = await open()
    await store.update(id, { ...model(page()), name: 'Theirs' })
    doc.rename('Mine')
    await doc.flush()
    await doc.loadTheirs()
    expect(doc.model?.name).toBe('Theirs')
    expect(doc.saveState).toBe('saved')
    expect(doc.canUndo).toBe(false)
    doc.rename('Edited after')
    expect(await doc.flush()).toBe(true)
    expect(await stored()).toMatchObject({ model: { name: 'Edited after' }, revision: 3 })
  })

  it('holds a model deleted elsewhere, and saves it as a new model on request', async () => {
    const doc = await open()
    await store.delete(id)
    doc.rename('Rescued')
    expect(await doc.flush()).toBe(false)
    expect(doc.saveState).toBe('deleted')
    const copy = await doc.saveCopy()
    expect(copy).not.toBe(id)
    expect((await store.get(copy))?.model.name).toBe('Rescued')
    expect(doc.saveState).toBe('saved')
  })

  it('tries a failed save again on request', async () => {
    const doc = await open()
    vi.spyOn(store, 'update').mockRejectedValueOnce(new Error('offline'))
    doc.rename('Later')
    await doc.flush()
    expect(doc.saveState).toBe('error')
    await doc.retry()
    expect(doc.saveState).toBe('saved')
    expect((await stored()).model.name).toBe('Later')
  })

  it('ignores a save still in flight when the edits are dropped (the model is being deleted)', async () => {
    const doc = await open()
    const late = deferred<number>()
    vi.spyOn(store, 'update').mockReturnValueOnce(late.promise)
    doc.rename('Going')
    vi.advanceTimersByTime(SAVE_DELAY_MS)
    doc.discard()
    late.reject(new ModelConflictError(id, 9))
    await vi.runAllTimersAsync()
    expect(doc.saveState).toBe('saved')
    expect(await doc.flush()).toBe(true)
  })

  it('a save started after the edits were dropped still happens, from the revision the dropped one made', async () => {
    const doc = await open()
    const real = store.update.bind(store)
    const first = deferred<void>()
    const update = vi.spyOn(store, 'update').mockImplementationOnce(async (...args) => {
      await first.promise
      return real(...args)
    })
    doc.rename('Dropped')
    vi.advanceTimersByTime(SAVE_DELAY_MS)
    doc.discard()
    doc.rename('Kept')
    vi.advanceTimersByTime(SAVE_DELAY_MS)
    // The dropped save still reached the store (revision 2), so the next one goes from there, not as a conflict.
    first.resolve()
    expect(await doc.flush()).toBe(true)
    expect(update.mock.calls.map((c) => [c[1].name, c[2]])).toEqual([
      ['Dropped', 1],
      ['Kept', 2],
    ])
    expect(await stored()).toMatchObject({ model: { name: 'Kept' }, revision: 3 })
  })

  it('never lets a slow read undo a save that landed meanwhile', async () => {
    const doc = await open()
    const real = store.get.bind(store)
    const read = deferred<void>()
    vi.spyOn(store, 'get').mockImplementationOnce(async (...args) => {
      const before = await real(...args)
      await read.promise
      return before
    })
    // A check starts and reads revision 1 slowly; meanwhile an edit is saved as revision 2.
    const refreshing = doc.refresh()
    doc.rename('Mine')
    expect(await doc.flush()).toBe(true)
    read.resolve()
    expect(await refreshing).toBe(false)
    expect(doc.model?.name).toBe('Mine')
    doc.rename('Mine again')
    expect(await doc.flush()).toBe(true)
    expect(doc.saveState).toBe('saved')
  })

  it('never replaces the model while text is being typed in place', async () => {
    const doc = await open()
    await store.update(id, { ...model(page()), name: 'Theirs' })
    let typing = true
    expect(await doc.refresh(() => !typing)).toBe(false)
    // Typing started while the read was out.
    const real = store.get.bind(store)
    vi.spyOn(store, 'get').mockImplementationOnce(async (...args) => {
      typing = true
      return real(...args)
    })
    typing = false
    expect(await doc.refresh(() => !typing)).toBe(false)
    typing = false
    expect(await doc.refresh(() => !typing)).toBe(true)
    expect(doc.model?.name).toBe('Theirs')
  })

  it('shows the stored model when only the automatic upgrade is refused, with no conflict', async () => {
    // A List stored before List was ported: opening it upgrades it, and the editor saves the upgrade.
    const legacy = { feature: 'ListFeature', id: '2', inputs: { name: 'Colors', list: 'Red,Green' } }
    const old = model(page(), { ...inst('ListFeature', '2', { ...legacy.inputs }), cache: { legacy } })
    id = await store.create(old)
    // Another tab opened it first and saved the upgrade.
    await store.update(id, { ...old, name: 'Upgraded elsewhere' })
    const doc = useDocumentStore()
    doc.editing = true
    const get = store.get.bind(store)
    vi.spyOn(store, 'get').mockImplementationOnce(async () => ({ model: old, revision: 1 }))
    await doc.load(id)
    expect(await doc.flush()).toBe(true)
    expect(doc.saveState).toBe('saved')
    vi.spyOn(store, 'get').mockImplementation(get)
    await vi.runAllTimersAsync()
    expect(doc.model?.name).toBe('Upgraded elsewhere')
    expect(doc.saveState).toBe('saved')
    // A user edit refused the same way is a conflict.
    await store.update(id, { ...old, name: 'Theirs' })
    doc.rename('Mine')
    expect(await doc.flush()).toBe(false)
    expect(doc.saveState).toBe('conflict')
  })

  it('says when a save failed because the sign-in expired, until a save works', async () => {
    const doc = await open()
    vi.spyOn(store, 'update').mockRejectedValueOnce(new SignedOutError())
    doc.rename('Later')
    await doc.flush()
    expect(doc.saveState).toBe('error')
    expect(doc.signedOut).toBe(true)
    await doc.retry()
    expect(doc.signedOut).toBe(false)
  })

  it('reads as saving while an edit waits behind a save in flight', async () => {
    const doc = await open()
    const real = store.update.bind(store)
    const late = deferred<void>()
    vi.spyOn(store, 'update').mockImplementationOnce(async (...args) => {
      await late.promise
      return real(...args)
    })
    doc.rename('First')
    vi.advanceTimersByTime(SAVE_DELAY_MS)
    doc.rename('Second')
    expect(doc.saveState).toBe('saving')
    late.resolve()
    await doc.flush()
    expect(doc.saveState).toBe('saved')
  })

  it('after saving a deleted model as a new one, never checks the deleted one again', async () => {
    const doc = await open()
    await store.delete(id)
    doc.rename('Rescued')
    await doc.flush()
    await doc.saveCopy()
    const get = vi.spyOn(store, 'get')
    expect(await doc.refresh()).toBe(false)
    expect(get).not.toHaveBeenCalled()
    expect(doc.status).toBe('ready')
  })

  it('says when closing the page would lose edits', async () => {
    const doc = await open()
    expect(doc.unsavedOnLeave()).toBe(false)
    // One edit waiting: the page sends it as it closes.
    doc.rename('Small')
    expect(doc.unsavedOnLeave()).toBe(false)
    // Too large for a request that outlives the page.
    doc.rename('x'.repeat(KEEPALIVE_MAX_BYTES))
    expect(doc.unsavedOnLeave()).toBe(true)
    await doc.flush()
    expect(doc.unsavedOnLeave()).toBe(false)
    // An edit queued behind a save in flight can't be sent as the page closes.
    const late = deferred<number>()
    vi.spyOn(store, 'update').mockReturnValueOnce(late.promise)
    doc.rename('In flight')
    vi.advanceTimersByTime(SAVE_DELAY_MS)
    expect(doc.unsavedOnLeave()).toBe(false)
    doc.rename('Queued')
    expect(doc.unsavedOnLeave()).toBe(true)
    late.resolve(4)
    await doc.flush()
  })

  it('refreshes only when the stored revision changed, and shows a model deleted elsewhere as missing', async () => {
    const doc = await open()
    expect(await doc.refresh()).toBe(false)
    doc.rename('Mine')
    await doc.flush()
    // Its own save is no change.
    expect(await doc.refresh()).toBe(false)
    expect(doc.canUndo).toBe(true)
    await store.update(id, { ...model(page()), name: 'Theirs' })
    expect(await doc.refresh()).toBe(true)
    expect(doc.model?.name).toBe('Theirs')
    // Undo would quietly take their save back.
    expect(doc.canUndo).toBe(false)
    // Saves now go from their revision.
    doc.rename('After')
    expect(await doc.flush()).toBe(true)
    await store.delete(id)
    expect(await doc.refresh()).toBe(true)
    expect(doc.status).toBe('missing')
  })

  it('never refreshes while a save is in flight', async () => {
    const doc = await open()
    const late = deferred<number>()
    vi.spyOn(store, 'update').mockReturnValueOnce(late.promise)
    doc.rename('Saving')
    vi.advanceTimersByTime(SAVE_DELAY_MS)
    const get = vi.spyOn(store, 'get')
    expect(await doc.refresh()).toBe(false)
    expect(get).not.toHaveBeenCalled()
    late.resolve(2)
    await doc.flush()
  })

  it("tells this browser's other tabs about each save, saying which tab saved", async () => {
    const heard: unknown[] = []
    const channel = new BroadcastChannel('feature-domain:models')
    channel.onmessage = (event) => heard.push(event.data)
    const doc = await open()
    doc.rename('Announced')
    await doc.flush()
    await vi.waitFor(() => expect(heard).toEqual([{ id, revision: 2, tab: TAB_ID }]))
    channel.close()
  })
})
