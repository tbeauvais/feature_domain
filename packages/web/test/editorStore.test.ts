import { MemoryModelStore, type AppModel } from '@feature-domain/engine'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setModelStore } from '../src/services'
import { SAVE_DELAY_MS, UNDO_COALESCE_MS, UNDO_LIMIT, useDocumentStore } from '../src/stores/document'
import { at, inst, model, page } from './helpers'

describe('editing with useDocumentStore', () => {
  let store: MemoryModelStore
  let id: string

  async function open(m: AppModel) {
    id = await store.create(m)
    const doc = useDocumentStore()
    doc.editing = true
    await doc.load(id)
    return doc
  }

  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    store = new MemoryModelStore()
    setModelStore(store)
  })
  afterEach(() => vi.useRealTimers())

  it('adds features from the palette, selects them and regenerates', async () => {
    const doc = await open(model(page()))
    const added = doc.add('TextFeature')
    expect(doc.selectedId).toBe(added)
    expect(doc.result?.root.children[0]?.children.map((n) => n.featureInstanceId)).toEqual([added])
  })

  it('edits inputs live and saves after a short delay', async () => {
    const doc = await open(model(page(), inst('TextFeature', 't', { text: 'a' })))
    doc.setInputs('t', { text: 'b' })
    expect(doc.result?.root.children[0]?.children[0]?.props).toEqual({ text: 'b' })
    expect(doc.saveState).toBe('pending')
    expect((await store.get(id))?.features[1]?.inputs.text).toBe('a')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect(doc.saveState).toBe('saved')
    expect((await store.get(id))?.features[1]?.inputs.text).toBe('b')
  })

  it('saves once after a burst of edits', async () => {
    const doc = await open(model(page(), inst('TextFeature', 't')))
    const update = vi.spyOn(store, 'update')
    for (const text of ['a', 'ab', 'abc']) {
      doc.setInputs('t', { text })
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS / 2)
    }
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect(update).toHaveBeenCalledTimes(1)
    expect((await store.get(id))?.features[1]?.inputs.text).toBe('abc')
  })

  it('flushes a pending save immediately, and before loading another model', async () => {
    const doc = await open(model(page(), inst('TextFeature', 't')))
    doc.rename('Renamed')
    await doc.flush()
    expect((await store.get(id))?.name).toBe('Renamed')
    doc.rename('Again')
    const other = await store.create(model(page()))
    await doc.load(other)
    expect((await store.get(id))?.name).toBe('Again')
  })

  it('reports save failures', async () => {
    const doc = await open(model(page()))
    vi.spyOn(store, 'update').mockRejectedValue(new Error('quota exceeded'))
    doc.rename('x')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect(doc.saveState).toBe('error')
    expect(doc.saveError).toBe('quota exceeded')
  })

  it('moves and removes features, clearing a selection that was removed', async () => {
    const doc = await open(model(page(), inst('ContainerFeature', 'c', { columns: 1 }), inst('TextFeature', 't', {}, at('c', 'r1c1')), inst('TextFeature', 'u')))
    doc.moveTo('u', at('c', 'r1c1'))
    expect(doc.model?.features.find((f) => f.id === 'u')?.placement).toEqual(at('c', 'r1c1'))
    doc.select('t')
    expect(doc.remove('c').removed).toEqual(['c', 't', 'u'])
    expect(doc.selectedId).toBeNull()
    expect(doc.model?.features.map((f) => f.id)).toEqual(['1'])
  })

  it('shows placeholders only in editing mode', async () => {
    const doc = await open(model(page(), inst('MapFeature', 'm')))
    expect(doc.result?.root.children[0]?.children.map((n) => n.kind)).toEqual(['placeholder'])
    doc.editing = false
    expect(doc.result?.root.children[0]?.children).toEqual([])
  })

  it('upgrades features stored before their type was ported, and saves the upgrade', async () => {
    const legacyList = { feature: 'ListFeature', id: '7', inputs: { name: 'Color list', list: 'Red,Yellow' } }
    const stored = { ...model(page()), features: [page(), { feature: 'ListFeature', id: '7', inputs: { name: 'Color list', list: 'Red,Yellow' }, placement: at('1', 'content'), cache: { legacy: legacyList } }] }
    const doc = await open(stored)
    expect(doc.model?.features[1]?.inputs.items).toEqual(['Red', 'Yellow'])
    expect(doc.result?.root.children[0]?.children[0]?.props).toEqual({ items: ['Red', 'Yellow'], align: 'left' })
    expect(doc.saveState).toBe('pending')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect((await store.get(id))?.features[1]).not.toHaveProperty('cache')
  })

  it('upgrades in memory only when not editing (the preview)', async () => {
    const legacyList = { feature: 'ListFeature', id: '7', inputs: { list: 'Red' } }
    id = await store.create({ ...model(page()), features: [page(), { feature: 'ListFeature', id: '7', inputs: {}, placement: at('1', 'content'), cache: { legacy: legacyList } }] })
    const doc = useDocumentStore()
    await doc.load(id)
    expect(doc.model?.features[1]?.inputs.items).toEqual(['Red'])
    expect(doc.saveState).toBe('saved')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect((await store.get(id))?.features[1]).toHaveProperty('cache')
  })

  it('never lets refresh replace edits that are not saved yet', async () => {
    const doc = await open(model(page()))
    doc.rename('Local edit')
    await store.update(id, { ...model(page()), name: 'From another tab' })
    expect(await doc.refresh()).toBe(false)
    expect(doc.model?.name).toBe('Local edit')
  })

  it('reports a failed flush, and a late failure does not touch the next model', async () => {
    const doc = await open(model(page()))
    const update = vi.spyOn(store, 'update').mockRejectedValue(new Error('quota exceeded'))
    doc.rename('x')
    expect(await doc.flush()).toBe(false)
    expect(doc.saveState).toBe('error')

    // An in-flight save that fails after another model opened.
    let fail!: (e: Error) => void
    update.mockImplementation(() => new Promise((_, reject) => (fail = reject)))
    doc.rename('y')
    vi.advanceTimersByTime(SAVE_DELAY_MS)
    update.mockResolvedValue(undefined)
    const other = await store.create(model(page()))
    const loading = doc.load(other)
    fail(new Error('late failure'))
    await loading
    expect(doc.modelId).toBe(other)
    expect(doc.saveState).toBe('saved')
  })

  it('refreshes from storage without a loading state, ignoring invalid data', async () => {
    const doc = await open(model(page()))
    await store.update(id, { ...model(page()), name: 'From another tab' })
    await doc.refresh()
    expect(doc.model?.name).toBe('From another tab')
    expect(doc.status).toBe('ready')
    vi.spyOn(store, 'get').mockResolvedValue({ version: 2 } as unknown as AppModel)
    await doc.refresh()
    expect(doc.model?.name).toBe('From another tab')
  })

  it('adding a Theme from the palette makes every page without one use it, in one undo step', async () => {
    const doc = await open(model(page(), inst('PageFeature', '2', { name: 'Second' }, at('$root', 'content'))))
    const themeId = doc.add('ThemeFeature')
    const themeOf = (pageId: string) => doc.model!.features.find((f) => f.id === pageId)!.inputs.theme
    expect([themeOf('1'), themeOf('2')]).toEqual([themeId, themeId])
    expect(doc.selectedId).toBe(themeId)
    expect(doc.result!.root.children.map((p) => (p.kind === 'page' ? p.props.theme?.scheme : undefined))).toEqual(['light', 'light'])
    doc.undo()
    expect(doc.model!.features.some((f) => f.feature === 'ThemeFeature')).toBe(false)
    expect(themeOf('1')).toBeUndefined()
    expect(doc.canUndo).toBe(false)
  })

  describe('undo and redo', () => {
    it('undoes and redoes edits, restoring the selection, and saves the result', async () => {
      const doc = await open(model(page()))
      expect(doc.canUndo).toBe(false)
      const added = doc.add('TextFeature')
      doc.select(null)
      doc.undo()
      expect(doc.model?.features.map((f) => f.id)).toEqual(['1'])
      expect(doc.selectedId).toBeNull()
      expect(doc.canRedo).toBe(true)
      doc.redo()
      expect(doc.model?.features.map((f) => f.id)).toEqual(['1', added])
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
      expect((await store.get(id))?.features).toHaveLength(2)
    })

    it('restores the selection that was current before the edit', async () => {
      const doc = await open(model(page(), inst('TextFeature', 't')))
      doc.select('t')
      doc.remove('t')
      expect(doc.selectedId).toBeNull()
      doc.undo()
      expect(doc.selectedId).toBe('t')
    })

    it('treats typing in one field as one step, but separate fields or pauses as separate steps', async () => {
      const doc = await open(model(page(), inst('TextFeature', 't', { text: '' })))
      for (const text of ['H', 'He', 'Hel']) doc.setInputs('t', { text })
      doc.setInputs('t', { name: 'x' })
      await vi.advanceTimersByTimeAsync(UNDO_COALESCE_MS + 1)
      doc.setInputs('t', { name: 'xy' })
      doc.undo()
      expect(doc.model?.features[1]?.inputs).toMatchObject({ text: 'Hel', name: 'x' })
      doc.undo()
      expect(doc.model?.features[1]?.inputs).toMatchObject({ text: 'Hel', name: 'TextFeature t' })
      doc.undo()
      expect(doc.model?.features[1]?.inputs.text).toBe('')
      expect(doc.canUndo).toBe(false)
    })

    it('drops redo after a new edit, and forgets history when another model loads', async () => {
      const doc = await open(model(page()))
      doc.rename('a')
      doc.undo()
      doc.add('TextFeature')
      expect(doc.canRedo).toBe(false)
      await doc.load(await store.create(model(page())))
      expect(doc.canUndo).toBe(false)
    })

    it('keeps at most UNDO_LIMIT steps', async () => {
      const doc = await open(model(page()))
      for (let i = 0; i < UNDO_LIMIT + 5; i++) doc.add('TextFeature')
      let steps = 0
      while (doc.canUndo) {
        doc.undo()
        steps++
      }
      expect(steps).toBe(UNDO_LIMIT)
    })

    it('does not make the automatic upgrade on open undoable', async () => {
      const legacyList = { feature: 'ListFeature', id: '7', inputs: { list: 'Red' } }
      const doc = await open({ ...model(page()), features: [page(), { feature: 'ListFeature', id: '7', inputs: {}, placement: at('1', 'content'), cache: { legacy: legacyList } }] })
      expect(doc.model?.features[1]?.inputs.items).toEqual(['Red'])
      expect(doc.canUndo).toBe(false)
    })
  })

  it('discards a pending save, e.g. before deleting the model', async () => {
    const doc = await open(model(page()))
    doc.rename('never saved')
    doc.discard()
    expect(doc.saveState).toBe('saved')
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect((await store.get(id))?.name).toBe('test')
    expect(await doc.flush()).toBe(true)
  })
})
