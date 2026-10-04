import { describe, expect, it } from 'vitest'
import { createRegistry, defaultRegistry, dependentsOf, generate, node, renderOutline, type FeatureDefinition } from '../src'
import { deepFreeze, inst, model, page } from './helpers'

const codes = (r: ReturnType<typeof generate>) => r.diagnostics.map((d) => `${d.code}:${d.featureInstanceId ?? ''}`)
const cell = (container: string, row: number, col: number) => `#container_${container}_row_${row}_col_${col}`

describe('generate', () => {
  it('places features into the page in model order', () => {
    const r = generate(model(page(), inst('TextFeature', '2', { text: 'a' }), inst('HeaderFeature', '3', { text: 'b' })))
    expect(r.diagnostics).toEqual([])
    expect(renderOutline(r.root)).toMatchInlineSnapshot(`
      "root #content_section
        page #page_container [1]
          text #textfeature_2_2 [2] {"text":"a"}
          heading #headerfeature_3_3 [3] {"text":"b","level":1,"align":"left"}"
    `)
  })

  it('places children into container cells even when they come first in the model', () => {
    const r = generate(
      model(
        inst('TextFeature', '5', { name: 'in cell' }, cell('box_4', 1, 2)),
        page(),
        inst('ContainerFeature', '4', { name: 'Box', columns: 2 }),
      ),
    )
    expect(r.diagnostics).toEqual([])
    expect(r.order).toEqual(['1', '4', '5'])
    const grid = r.root.children[0]!.children[0]!
    expect(grid.kind).toBe('grid')
    expect(grid.children[1]!.children.map((c) => c.featureInstanceId)).toEqual(['5'])
  })

  it('keeps sibling order from the model, not from dependency order', () => {
    const r = generate(
      model(
        page(),
        inst('TextFeature', 'late', {}, cell('outer_o', 1, 1)),
        inst('ContainerFeature', 'o', { name: 'outer', columns: 1 }),
        inst('TextFeature', 'early', {}, cell('outer_o', 1, 1)),
      ),
    )
    const slot = r.root.children[0]!.children[0]!.children[0]!
    expect(slot.children.map((c) => c.featureInstanceId)).toEqual(['late', 'early'])
  })

  it('suppresses disabled features and everything placed inside them', () => {
    const r = generate(
      model(
        page(),
        inst('ContainerFeature', 'c', { name: 'c', disable: true, columns: 1 }),
        inst('TextFeature', 't', {}, cell('c_c', 1, 1)),
        inst('TextFeature', 'other'),
      ),
    )
    expect(codes(r)).toEqual(['suppressed:c', 'suppressed:t'])
    expect(r.metadata.features.find((f) => f.id === 't')?.status).toBe('suppressed')
    expect(r.root.children[0]!.children.map((c) => c.featureInstanceId)).toEqual(['other'])
  })

  it('accepts the legacy string encoding of disable', () => {
    const r = generate(model(page(), inst('TextFeature', 't', { disable: 'true' })))
    expect(codes(r)).toEqual(['suppressed:t'])
  })

  it('reports unknown features and skips features placed inside them', () => {
    const r = generate(model(page(), inst('PanelFeature', 'p'), inst('TextFeature', 't', {}, '#panel_p_panel')))
    expect(codes(r)).toEqual(['unknown-feature:p', 'unresolved-target:t'])
  })

  it('reports missing and unresolved targets', () => {
    const noTarget = { feature: 'TextFeature', id: 'n', inputs: { name: 'n' } }
    const r = generate(model(page(), noTarget, inst('TextFeature', 'u', {}, '#nowhere')))
    expect(codes(r)).toEqual(['missing-target:n', 'unresolved-target:u'])
    expect(r.metadata.features.map((f) => f.status)).toEqual(['generated', 'skipped', 'skipped'])
  })

  it('reports placement cycles and skips features behind them', () => {
    const r = generate(
      model(
        page(),
        inst('ContainerFeature', 'a', { name: 'a', columns: 1 }, cell('b_b', 1, 1)),
        inst('ContainerFeature', 'b', { name: 'b', columns: 1 }, cell('a_a', 1, 1)),
        inst('TextFeature', 't', {}, cell('b_b', 1, 1)),
      ),
    )
    expect(codes(r)).toEqual(['cycle:a', 'cycle:b', 'parent-skipped:t'])
  })

  it('reports a feature placed inside itself', () => {
    const r = generate(model(page(), inst('ContainerFeature', 'a', { name: 'a', columns: 1 }, cell('a_a', 1, 1))))
    expect(codes(r)).toEqual(['cycle:a'])
  })

  it('reports duplicate instance ids', () => {
    const r = generate(model(page(), inst('TextFeature', '1')))
    expect(codes(r)).toEqual(['duplicate-id:1'])
  })

  it('places children in the first provider of a duplicated target and skips the rest', () => {
    const r = generate(model(page(), { ...page(), id: '2' }, inst('TextFeature', 't')))
    expect(codes(r)).toEqual(['duplicate-target:2'])
    expect(r.root.children.map((c) => c.featureInstanceId)).toEqual(['1'])
    expect(r.root.children[0]!.children.map((c) => c.featureInstanceId)).toEqual(['t'])
    expect(r.metadata.features.find((f) => f.id === '2')?.status).toBe('skipped')
    expect(r.metadata.targets.filter((t) => t.id === 'page_container')).toEqual([{ id: 'page_container', page: 'Page 1', providedBy: '1' }])
  })

  it('skips a feature whose generated node ids clash with another feature', () => {
    // Legacy ids are name + "_" + id, so "x_1" + "2" and "x" + "1_2" both become "x_1_2".
    const r = generate(model(page(), inst('TextFeature', '2', { name: 'x_1' }), inst('TextFeature', '1_2', { name: 'x' })))
    expect(codes(r)).toEqual(['duplicate-node-id:1_2'])
    expect(r.root.children[0]!.children.map((c) => c.featureInstanceId)).toEqual(['2'])
  })

  it('allows non-Page features at the root target', () => {
    const r = generate(model(inst('TextFeature', 't', { text: 'top' }, '#content_section')))
    expect(r.diagnostics).toEqual([])
    expect(r.root.children.map((c) => c.kind)).toEqual(['text'])
  })

  it('suppresses features inside a suppressed grandparent', () => {
    const r = generate(
      model(
        page(),
        inst('ContainerFeature', 'g', { name: 'g', disable: true, columns: 1 }),
        inst('ContainerFeature', 'p', { name: 'p', columns: 1 }, cell('g_g', 1, 1)),
        inst('TextFeature', 't', {}, cell('p_p', 1, 1)),
      ),
    )
    expect(codes(r)).toEqual(['suppressed:g', 'suppressed:p', 'suppressed:t'])
  })

  it('records metadata for pages, features and drop targets', () => {
    const r = generate(model(page(), inst('ContainerFeature', 'c', { name: 'Grid', rows: 1, columns: 2 })))
    expect(r.metadata.pages).toEqual(['Page 1'])
    expect(r.metadata.features[1]).toEqual({
      id: 'c',
      feature: 'ContainerFeature',
      name: 'Grid',
      domId: 'grid_c',
      page: 'Page 1',
      target: 'page_container',
      slots: ['container_grid_c_row_1_col_1', 'container_grid_c_row_1_col_2'],
      status: 'generated',
    })
    expect(r.metadata.targets.map((t) => `${t.id}<-${t.providedBy}`)).toEqual([
      'content_section<-null',
      'page_container<-1',
      'container_grid_c_row_1_col_1<-c',
      'container_grid_c_row_1_col_2<-c',
    ])
  })

  it('exposes the dependency graph for incremental regeneration', () => {
    const r = generate(
      model(
        page(),
        inst('ContainerFeature', 'outer', { name: 'o', columns: 1 }),
        inst('ContainerFeature', 'inner', { name: 'i', columns: 1 }, cell('o_outer', 1, 1)),
        inst('TextFeature', 'leaf', {}, cell('i_inner', 1, 1)),
        inst('TextFeature', 'sibling'),
      ),
    )
    expect(dependentsOf(r.graph, '1')).toEqual(['outer', 'inner', 'leaf', 'sibling'])
    expect(dependentsOf(r.graph, 'outer')).toEqual(['inner', 'leaf'])
    expect(dependentsOf(r.graph, 'sibling')).toEqual([])
  })

  it('includes unplaceable features in the graph', () => {
    const r = generate(
      model(page(), inst('ContainerFeature', 'lost', { name: 'lost', columns: 1 }, '#nowhere'), inst('TextFeature', 't', {}, cell('lost_lost', 1, 1))),
    )
    expect(codes(r)).toEqual(['unresolved-target:lost', 'parent-skipped:t'])
    expect(r.graph.nodes).toEqual(['1', 'lost', 't'])
    expect(dependentsOf(r.graph, 'lost')).toEqual(['t'])
  })

  it('does not mutate the model and is deterministic', () => {
    const m = deepFreeze(model(page({ border_color: 'red' }), inst('ContainerFeature', 'c', { name: 'c' }), inst('TextFeature', 't', {}, cell('c_c', 1, 1))))
    const first = generate(m)
    expect(generate(m)).toEqual(first)
  })

  it('reflects a parameter change throughout the document', () => {
    const before = generate(model(page(), inst('ContainerFeature', 'c', { name: 'c', columns: 1 })))
    const after = generate(model(page(), inst('ContainerFeature', 'c', { name: 'c', columns: 3 })))
    expect(before.metadata.targets).toHaveLength(3)
    expect(after.metadata.targets).toHaveLength(5)
  })
})

describe('generate with custom features', () => {
  const stub = (def: Partial<FeatureDefinition> & Pick<FeatureDefinition, 'type' | 'generate'>): FeatureDefinition => ({
    name: def.type,
    icon: 'box',
    inputs: [],
    ...def,
  })
  const registry = (...defs: FeatureDefinition[]) => createRegistry([...defaultRegistry.values(), ...defs])

  it('skips children of a target the parent declared but did not generate', () => {
    const broken = stub({ type: 'Broken', slots: () => ['hole'], generate: (_, ctx) => node(ctx.domId, 'box') })
    const r = generate(model(page(), inst('Broken', 'b'), inst('TextFeature', 't', {}, '#hole')), registry(broken))
    expect(codes(r)).toEqual(['missing-slot:b', 'parent-skipped:t'])
    expect(r.metadata.features.find((f) => f.id === 't')?.status).toBe('skipped')
  })

  it('never mutates nodes returned by features', () => {
    // A feature returning one shared, frozen node must not accumulate children across runs.
    const shared = Object.freeze(node('shared', 'box', {}, Object.freeze([]) as never))
    const holder = stub({ type: 'Holder', slots: () => ['shared'], generate: () => shared })
    const m = model(page(), inst('Holder', 'h'), inst('TextFeature', 't', {}, '#shared'))
    const first = generate(m, registry(holder))
    const second = generate(m, registry(holder))
    expect(codes(second)).toEqual([])
    expect(second.root).toEqual(first.root)
    expect(shared.children).toEqual([])
    expect(second.root.children[0]!.children[0]!.children.map((c) => c.featureInstanceId)).toEqual(['t'])
  })
})
