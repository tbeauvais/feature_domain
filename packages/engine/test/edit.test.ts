import { describe, expect, it } from 'vitest'
import {
  addFeature,
  canPlace,
  coreFeatures,
  descendantsOf,
  EditError,
  generate,
  insertFeature,
  moveFeature,
  nextInstanceId,
  normalizeOrder,
  removeFeature,
  renderOutline,
  ROOT_ID,
  updateInputs,
  type AppModel,
} from '../src'
import { at, deepFreeze, inst, model, page, resource } from './helpers'

const ids = (m: AppModel) => m.features.map((f) => f.id)
const placementOf = (m: AppModel, id: string) => m.features.find((f) => f.id === id)?.placement

// page 1 > container c (2 cells) > text t in r1c1; text u in page
const base = () =>
  deepFreeze(model(page(), inst('ContainerFeature', 'c', { columns: 2 }), inst('TextFeature', 't', {}, at('c', 'r1c1')), inst('TextFeature', 'u')))

describe('nextInstanceId', () => {
  it('is the highest numeric id + 1, ignoring non-numeric ids', () => {
    expect(nextInstanceId(model())).toBe('1')
    expect(nextInstanceId(model(page(), inst('TextFeature', '41'), inst('TextFeature', 'x9'), inst('TextFeature', '7')))).toBe('42')
  })
})

describe('descendantsOf', () => {
  it('returns everything placed inside a feature, transitively, in model order', () => {
    const m = model(page(), inst('ContainerFeature', 'c', { columns: 1 }), inst('PanelFeature', 'p', {}, at('c', 'r1c1')), inst('TextFeature', 't', {}, at('p', 'body')))
    expect(descendantsOf(m, 'c')).toEqual(['p', 't'])
    expect(descendantsOf(m, '1')).toEqual(['c', 'p', 't'])
    expect(descendantsOf(m, 't')).toEqual([])
  })
})

describe('normalizeOrder', () => {
  it('puts features after their parent and the features they reference, without changing the page', () => {
    const m = model(inst('TextFeature', 'a', {}, at('c', 'r1c1')), page(), inst('TableFeature', 't', { data_resource: 'r' }), inst('TextFeature', 'b', {}, at('c', 'r1c1')), inst('ContainerFeature', 'c'), resource('r'))
    const sorted = normalizeOrder(m)
    // The page shows table t before container c; dependencies (page 1, resource r) are pulled forward instead.
    expect(ids(sorted)).toEqual(['1', 'r', 't', 'c', 'a', 'b'])
    expect(generate(sorted).diagnostics.filter((d) => d.code === 'out-of-order')).toEqual([])
    expect(renderOutline(generate(sorted).root)).toBe(renderOutline(generate(m).root))
  })

  it('pulls a referenced resource forward instead of pushing the table below its siblings', () => {
    // Table 2 and Text 3 on the page; DataResource 4 added later, then linked to the table.
    const m = model(page(), inst('TableFeature', '2', { data_resource: '' }), inst('TextFeature', '3'), resource('4'))
    const linked = updateInputs(m, '2', { data_resource: '4' })
    expect(ids(linked)).toEqual(['1', '4', '2', '3'])
    expect(generate(linked).root.children[0]!.children.map((n) => n.featureInstanceId)).toEqual(['2', '3'])
  })

  it('returns the same object when the order is already valid', () => {
    const m = base()
    expect(normalizeOrder(m)).toBe(m)
  })

  it('leaves features on a cycle at the end, in model order', () => {
    const m = model(inst('ContainerFeature', 'a', { columns: 1 }, at('b', 'r1c1')), page(), inst('ContainerFeature', 'b', { columns: 1 }, at('a', 'r1c1')))
    expect(ids(normalizeOrder(m))).toEqual(['1', 'a', 'b'])
  })
})

describe('insertFeature and addFeature', () => {
  it('appends to a slot after its existing children, or before a given sibling', () => {
    const m = base()
    expect(ids(insertFeature(m, inst('TextFeature', 'n'), at('1', 'content')))).toEqual(['1', 'c', 't', 'u', 'n'])
    expect(ids(insertFeature(m, inst('TextFeature', 'n'), { ...at('1', 'content'), before: 'u' }))).toEqual(['1', 'c', 't', 'n', 'u'])
    expect(ids(insertFeature(m, inst('TextFeature', 'n'), at('c', 'r1c2')))).toEqual(['1', 'c', 'n', 't', 'u'])
  })

  it('ignores a target for features that are not placed', () => {
    const next = insertFeature(base(), resource('r'), at('1', 'content'))
    expect(next.features.at(-1)).toEqual(resource('r'))
  })

  it('validates the target like moveFeature does', () => {
    const m = base()
    expect(() => insertFeature(m, inst('TextFeature', 'n'), { ...at('c', 'r1c2'), before: 't' })).toThrow('Feature t is not in that slot')
    expect(() => insertFeature(m, inst('TextFeature', 'n'), at('c', 'r9c9'))).toThrow('There is no slot "r9c9" in feature c')
    expect(() => insertFeature(m, inst('MapFeature', 'n'), at('1', 'content'))).toThrow('Unknown feature type "MapFeature"')
  })

  it('refuses duplicate ids', () => {
    expect(() => insertFeature(base(), inst('TextFeature', 't'), at('1', 'content'))).toThrow(EditError)
  })

  it('adds a new instance with default inputs and the next id', () => {
    const { model: next, id } = addFeature(model(page()), 'HeaderFeature', at('1', 'content'))
    expect(id).toBe('2')
    expect(next.features[1]).toMatchObject({ feature: 'HeaderFeature', id: '2', inputs: { text: 'Enter your header text here' }, placement: at('1', 'content') })
    expect(() => addFeature(model(page()), 'NopeFeature', at('1', 'content'))).toThrow('Unknown feature type "NopeFeature"')
  })
})

describe('canPlace', () => {
  it('accepts generated slots and refuses everything else, with a reason', () => {
    const m = base()
    const check = (subject: { id: string } | { feature: string }, parent: string, slot: string, before?: string) =>
      canPlace(m, subject, before === undefined ? at(parent, slot) : { ...at(parent, slot), before })
    expect(check({ id: 'u' }, 'c', 'r1c2')).toEqual({ ok: true })
    expect(check({ feature: 'ImageFeature' }, ROOT_ID, 'content')).toEqual({ ok: true })
    expect(check({ id: 'u' }, 'c', 'r9c9')).toEqual({ ok: false, reason: 'There is no slot "r9c9" in feature c' })
    expect(check({ id: 'u' }, 't', 'body')).toEqual({ ok: false, reason: 'There is no slot "body" in feature t' })
    expect(check({ id: 'c' }, 'c', 'r1c1')).toEqual({ ok: false, reason: 'A feature cannot be placed inside itself' })
    expect(check({ id: '1' }, 'c', 'r1c1')).toEqual({ ok: false, reason: 'A feature cannot be placed inside itself' })
    expect(check({ feature: 'DataResourceFeature' }, '1', 'content')).toEqual({ ok: false, reason: 'DataResource features are not placed on the page' })
    expect(check({ feature: 'MapFeature' }, '1', 'content')).toEqual({ ok: false, reason: 'Unknown feature type "MapFeature"' })
    expect(check({ id: 'nope' }, '1', 'content')).toEqual({ ok: false, reason: 'Feature nope does not exist' })
    expect(check({ id: 'u' }, '1', 'content', 't')).toEqual({ ok: false, reason: 'Feature t is not in that slot' })
  })
})

describe('moveFeature', () => {
  it('moves a feature and everything inside it', () => {
    const m = base()
    const moved = moveFeature(moveFeature(m, 'u', at('c', 'r1c2')), 'c', { ...at('1', 'content'), before: undefined })
    expect(placementOf(moved, 'u')).toEqual(at('c', 'r1c2'))
    expect(generate(moved).diagnostics).toEqual([])
  })

  it('reorders siblings with before', () => {
    const m = model(page(), inst('TextFeature', 'a'), inst('TextFeature', 'b'), inst('TextFeature', 'c'))
    expect(ids(moveFeature(m, 'c', { ...at('1', 'content'), before: 'a' }))).toEqual(['1', 'c', 'a', 'b'])
    expect(ids(moveFeature(m, 'a', at('1', 'content')))).toEqual(['1', 'b', 'c', 'a'])
    expect(moveFeature(m, 'b', { ...at('1', 'content'), before: 'b' })).toBe(m)
  })

  it('refuses moves that canPlace refuses', () => {
    expect(() => moveFeature(base(), 'c', at('c', 'r1c2'))).toThrow('A feature cannot be placed inside itself')
  })

  it('moves a child ahead of its new parent in model order', () => {
    const m = model(page(), inst('TextFeature', 'early'), inst('ContainerFeature', 'late', { columns: 1 }))
    const moved = moveFeature(m, 'early', at('late', 'r1c1'))
    expect(ids(moved)).toEqual(['1', 'late', 'early'])
  })
})

describe('removeFeature', () => {
  it('removes the feature with everything inside it, and reports broken references', () => {
    const m = model(page(), resource('r'), inst('ContainerFeature', 'c', { columns: 1 }), inst('TableFeature', 't', { data_resource: 'r' }, at('c', 'r1c1')), inst('TableFeature', 'o', { data_resource: 'r' }))
    expect(removeFeature(m, 'c')).toMatchObject({ removed: ['c', 't'], brokenReferences: [] })
    const result = removeFeature(m, 'r')
    expect(ids(result.model)).toEqual(['1', 'c', 't', 'o'])
    expect(result.brokenReferences).toEqual([
      { id: 't', references: ['r'] },
      { id: 'o', references: ['r'] },
    ])
    // Their reference inputs are cleared, so they report a missing selection rather than a missing feature.
    expect(result.model.features.find((f) => f.id === 'o')!.inputs.data_resource).toBe('')
    expect(m.features.find((f) => f.id === 'o')!.inputs.data_resource).toBe('r')
    expect(() => removeFeature(m, 'nope')).toThrow(EditError)
  })
})

describe('updateInputs', () => {
  it('changes inputs, removes undefined ones, and keeps the order valid', () => {
    const m = model(page(), inst('TableFeature', 't', { data_resource: '' }), resource('r'))
    const next = updateInputs(m, 't', { data_resource: 'r', name: undefined })
    expect(next.features.find((f) => f.id === 't')!.inputs).toEqual({ data_resource: 'r' })
    expect(ids(next)).toEqual(['1', 'r', 't'])
    expect(m.features[1]!.inputs.data_resource).toBe('')
  })
})

describe('random edit sequences', () => {
  // A small deterministic PRNG, so failures reproduce.
  function prng(seed: number) {
    let s = seed
    return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
  }

  it.each([1, 2, 3, 4, 5])('keep the model valid (seed %i)', (seed) => {
    const random = prng(seed)
    const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)]!
    const placeable = coreFeatures.filter((f) => f.placement === 'required').map((f) => f.type)
    let m: AppModel = model(page())

    for (let step = 0; step < 120; step++) {
      const result = generate(m)
      const action = random()
      const placed = m.features.filter((f) => f.placement && f.id !== '1')
      if (action < 0.45 || placed.length === 0) {
        const type = random() < 0.1 ? 'DataResourceFeature' : pick(placeable)
        const target = pick(result.metadata.targets)
        if (type === 'DataResourceFeature' || canPlace(m, { feature: type }, target, { result }).ok) m = addFeature(m, type, target).model
      } else if (action < 0.75) {
        const subject = pick(placed)
        const target = pick(result.metadata.targets)
        const check = canPlace(m, { id: subject.id }, target, { result })
        if (check.ok) m = moveFeature(m, subject.id, target)
        else expect(() => moveFeature(m, subject.id, target)).toThrow(check.reason)
      } else if (action < 0.9) {
        m = removeFeature(m, pick(placed).id).model
      } else {
        const table = m.features.find((f) => f.feature === 'TableFeature')
        const res = m.features.find((f) => f.feature === 'DataResourceFeature')
        if (table && res) m = updateInputs(m, table.id, { data_resource: res.id })
      }

      // Normalizing never changes the page, whatever order the features are listed in.
      const shuffled = { ...m, features: [...m.features].sort(() => random() - 0.5) }
      expect(renderOutline(generate(normalizeOrder(shuffled)).root), `step ${step}`).toBe(renderOutline(generate(shuffled).root))

      const after = generate(m)
      const codes = after.diagnostics.map((d) => d.code)
      expect(new Set(ids(m)).size, `step ${step}`).toBe(m.features.length)
      expect(codes.filter((c) => ['out-of-order', 'cycle', 'duplicate-id', 'duplicate-node-id', 'unresolved-placement', 'missing-placement'].includes(c)), `step ${step}`).toEqual([])
      expect(normalizeOrder(m)).toBe(m)
    }
    expect(m.features.length).toBeGreaterThan(5)
  })
})
