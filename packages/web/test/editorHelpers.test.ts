import { generate, ROOT_ID } from '@feature-domain/engine'
import { describe, expect, it } from 'vitest'
import { buildFeatureTree, type TreeItem } from '../src/editor/featureTree'
import { paletteTarget } from '../src/editor/targets'
import { themeForFeature } from '../src/editor/themeFor'
import { DEFAULT_TOKENS } from '../src/renderer/theme'
import { at, inst, model, page } from './helpers'

// page 1 > [container c (2 cells) > text t in r1c2], text u
const m = model(page(), inst('ContainerFeature', 'c', { name: 'Grid', columns: 2 }), inst('TextFeature', 't', {}, at('c', 'r1c2')), inst('TextFeature', 'u'))
const result = generate(m)

describe('paletteTarget', () => {
  it('adds into the selected feature when it has a slot', () => {
    expect(paletteTarget(m, result, 'c', 'TextFeature')).toEqual(at('c', 'r1c1'))
    expect(paletteTarget(m, result, '1', 'TextFeature')).toEqual(at('1', 'content'))
  })

  it('adds right after the selected feature in its slot', () => {
    expect(paletteTarget(m, result, 'u', 'TextFeature')).toEqual(at('1', 'content'))
    expect(paletteTarget(m, result, 't', 'TextFeature')).toEqual(at('c', 'r1c2'))
    const two = model(page(), inst('TextFeature', 'a'), inst('TextFeature', 'b'))
    expect(paletteTarget(two, generate(two), 'a', 'TextFeature')).toEqual({ ...at('1', 'content'), before: 'b' })
  })

  it('adds to the first page without a usable selection, and pages at the root', () => {
    expect(paletteTarget(m, result, null, 'TextFeature')).toEqual(at('1', 'content'))
    expect(paletteTarget(m, result, 'missing', 'TextFeature')).toEqual(at('1', 'content'))
    expect(paletteTarget(m, result, 'c', 'PageFeature')).toEqual(at(ROOT_ID, 'content'))
    expect(paletteTarget(model(), generate(model()), null, 'TextFeature')).toEqual(at(ROOT_ID, 'content'))
  })
})

describe('buildFeatureTree', () => {
  const shape = (items: TreeItem[]): unknown[] =>
    items.map((i) => [i.id, i.status, ...(i.slot ? [i.slot] : []), ...(i.reason ? [i.reason] : []), ...(i.children.length ? [shape(i.children)] : [])])

  it('nests features by placement in model order, showing cell slots', () => {
    const tree = buildFeatureTree(result)
    expect(shape(tree.roots)).toEqual([['1', 'generated', [['c', 'generated', [['t', 'generated', 'r1c2']]], ['u', 'generated']]]])
    expect(tree.roots[0]!.children[0]!.label).toBe('Grid')
    expect(tree.resources).toEqual([])
    expect(tree.unplaced).toEqual([])
  })

  it('lists skipped, unknown and suppressed features with why; resources and themes, and unplaced features, separately', () => {
    const tricky = model(
      page(),
      inst('MapFeature', 'map'),
      inst('TableFeature', 'tbl', { data_resource: '' }),
      inst('TextFeature', 'off', { disable: true }),
      inst('DataResourceFeature', 'r', { name: 'Repos' }, null),
      inst('ThemeFeature', 'th', { name: 'Warm' }, null),
      inst('TextFeature', 'nowhere-text', {}, null),
      inst('ContainerFeature', 'lost', { columns: 1 }, at('nowhere', 'x')),
      inst('TextFeature', 'in-lost', {}, at('lost', 'r1c1')),
    )
    const tree = buildFeatureTree(generate(tricky))
    expect(shape(tree.roots)).toEqual([
      [
        '1',
        'generated',
        [
          ['map', 'unknown', 'MapFeature is not ported yet'],
          ['tbl', 'skipped', 'No Data Resource selected'],
          ['off', 'suppressed', 'Feature is suppressed'],
        ],
      ],
    ])
    expect(shape(tree.resources)).toEqual([
      ['r', 'generated'],
      ['th', 'generated'],
    ])
    expect(tree.resources[1]!.label).toBe('Warm')
    expect(shape(tree.unplaced)).toEqual([
      ['nowhere-text', 'skipped', 'Feature has no placement'],
      ['lost', 'skipped', 'Parent feature nowhere does not exist', [['in-lost', 'skipped', 'Parent feature lost ("ContainerFeature lost") was not generated']]],
    ])
  })
})

describe('themeForFeature', () => {
  const themed = model(
    inst('ThemeFeature', 'th', { name: 'Forest', accent: '#2f6b3a', scheme: 'dark' }, null),
    inst('ThemeFeature', 'th2', { name: 'Plum', accent: '#7a1f55' }, null),
    page({ theme: 'th' }),
    inst('ImageFeature', 'a'),
    inst('PageFeature', '2', { theme: 'th2' }, at(ROOT_ID, 'content')),
    inst('ImageFeature', 'b', {}, at('2', 'content')),
    inst('PageFeature', '3', {}, at(ROOT_ID, 'content')),
    inst('ImageFeature', 'c', {}, at('3', 'content')),
  )
  const root = generate(themed).root
  const accent = (id: string | null) => themeForFeature(root, id).vars['--fd-accent-solid']

  it('uses the theme of the page the feature is on', () => {
    expect(accent('a')).toBe('#2f6b3a')
    expect(accent('b')).toBe('#7a1f55')
  })

  it('falls back to the document theme (the first page\'s) on an unthemed page, with nothing selected, or for unknown ids', () => {
    for (const id of ['c', null, 'nope']) expect(accent(id)).toBe('#2f6b3a')
  })

  it('uses the default theme without pages', () => {
    expect(themeForFeature(undefined, 'a')).toBe(DEFAULT_TOKENS)
    expect(themeForFeature(generate(model()).root, null)).toBe(DEFAULT_TOKENS)
  })
})
