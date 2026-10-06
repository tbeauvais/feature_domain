import { generate, ROOT_ID } from '@feature-domain/engine'
import { describe, expect, it } from 'vitest'
import { evaluateDrop, intoSlot, siblingsIn, zoneTarget, type DropZone } from '../src/editor/dnd'
import { at, inst, model, page } from './helpers'

// page 1 > [a, container c (2 cells) > [t in r1c1, u in r1c1], b]
const m = model(
  page(),
  inst('TextFeature', 'a'),
  inst('ContainerFeature', 'c', { columns: 2 }),
  inst('TextFeature', 't', {}, at('c', 'r1c1')),
  inst('TextFeature', 'u', {}, at('c', 'r1c1')),
  inst('TextFeature', 'b'),
)
const result = generate(m)
const feature = (id: string, operation: 'reorder-before' | 'reorder-after' | 'combine'): DropZone => ({ kind: 'feature', id, operation })

describe('zoneTarget', () => {
  it('maps before/after a feature to its slot, and into a feature to its first slot', () => {
    expect(siblingsIn(m, '1', 'content')).toEqual(['a', 'c', 'b'])
    expect(zoneTarget(m, result, feature('c', 'reorder-before'))).toEqual({ ...at('1', 'content'), before: 'c' })
    expect(zoneTarget(m, result, feature('c', 'reorder-after'))).toEqual({ ...at('1', 'content'), before: 'b' })
    expect(zoneTarget(m, result, feature('b', 'reorder-after'))).toEqual(at('1', 'content'))
    expect(zoneTarget(m, result, feature('c', 'combine'))).toEqual(at('c', 'r1c1'))
    expect(zoneTarget(m, result, feature('a', 'combine'))).toBeNull()
    expect(zoneTarget(m, result, { kind: 'slot', parent: 'c', slot: 'r1c2' })).toEqual(at('c', 'r1c2'))
    expect(intoSlot(result, '1')).toEqual(at('1', 'content'))
  })
})

describe('evaluateDrop', () => {
  it('allows valid moves and palette drops', () => {
    expect(evaluateDrop(m, result, { kind: 'feature', id: 'a' }, { kind: 'slot', parent: 'c', slot: 'r1c2' })).toEqual({ allowed: true, target: at('c', 'r1c2'), noop: false })
    expect(evaluateDrop(m, result, { kind: 'palette', featureType: 'ImageFeature' }, feature('t', 'reorder-after'))).toEqual({ allowed: true, target: { ...at('c', 'r1c1'), before: 'u' }, noop: false })
    expect(evaluateDrop(m, result, { kind: 'palette', featureType: 'PageFeature' }, { kind: 'slot', parent: ROOT_ID, slot: 'content' })).toMatchObject({ allowed: true })
  })

  it('refuses drops into a feature itself or its descendants, and into features without slots', () => {
    expect(evaluateDrop(m, result, { kind: 'feature', id: 'c' }, { kind: 'slot', parent: 'c', slot: 'r1c2' })).toEqual({
      allowed: false,
      target: at('c', 'r1c2'),
      reason: 'A feature cannot be placed inside itself',
    })
    expect(evaluateDrop(m, result, { kind: 'feature', id: '1' }, feature('t', 'reorder-before'))).toMatchObject({ allowed: false, reason: 'A feature cannot be placed inside itself' })
    expect(evaluateDrop(m, result, { kind: 'feature', id: 'b' }, feature('a', 'combine'))).toMatchObject({ allowed: false, reason: 'Features cannot be placed inside this feature' })
    expect(evaluateDrop(m, result, { kind: 'palette', featureType: 'DataResourceFeature' }, { kind: 'slot', parent: '1', slot: 'content' })).toMatchObject({ allowed: false })
  })

  it('recognises drops that would leave a feature where it is', () => {
    const noop = (id: string, zone: DropZone) => (evaluateDrop(m, result, { kind: 'feature', id }, zone) as { noop?: boolean }).noop
    expect(noop('c', feature('c', 'reorder-before'))).toBe(true)
    expect(noop('c', feature('a', 'reorder-after'))).toBe(true)
    expect(noop('c', feature('b', 'reorder-before'))).toBe(true)
    expect(noop('b', { kind: 'slot', parent: '1', slot: 'content' })).toBe(true)
    expect(noop('a', feature('b', 'reorder-after'))).toBe(false)
    expect(noop('t', feature('u', 'reorder-after'))).toBe(false)
  })
})
