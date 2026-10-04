import { describe, expect, it } from 'vitest'
import {
  createRegistry,
  defaultRegistry,
  dependentsOf,
  generate,
  node,
  renderOutline,
  ROOT_ID,
  type FeatureDefinition,
} from '../src'
import { at, deepFreeze, inst, model, page, resource } from './helpers'

const codes = (r: ReturnType<typeof generate>) => r.diagnostics.map((d) => `${d.code}:${d.featureInstanceId ?? ''}`)
const statusOf = (r: ReturnType<typeof generate>, id: string) => r.metadata.features.find((f) => f.id === id)?.status
const pageNode = (r: ReturnType<typeof generate>) => r.root.children[0]!

describe('placement', () => {
  it('places features into the page in model order', () => {
    const r = generate(model(page(), inst('TextFeature', '2', { text: 'a' }), inst('HeaderFeature', '3', { text: 'b' })))
    expect(r.diagnostics).toEqual([])
    expect(renderOutline(r.root)).toMatchInlineSnapshot(`
      "root #$root <content>
        page #1 <content> [1]
          text #2 [2] {"text":"a"}
          heading #3 [3] {"text":"b","level":1,"align":"center","tone":"info"}"
    `)
  })

  it('places features into container cells and panel bodies', () => {
    const r = generate(
      model(
        page(),
        inst('ContainerFeature', 'c', { columns: 2 }),
        inst('TextFeature', 't', {}, at('c', 'r1c2')),
        inst('PanelFeature', 'p', { heading: 'P' }, at('c', 'r1c1')),
        inst('TextFeature', 'u', {}, at('p', 'body')),
      ),
    )
    expect(r.diagnostics).toEqual([])
    const [cell1, cell2] = pageNode(r).children[0]!.children
    expect(cell2!.children.map((n) => n.featureInstanceId)).toEqual(['t'])
    expect(cell1!.children[0]!.children[0]!.children.map((n) => n.featureInstanceId)).toEqual(['u'])
  })

  it('keeps sibling order from the model, not from dependency order', () => {
    const r = generate(
      model(page(), inst('ContainerFeature', 'o', { columns: 1 }), inst('TextFeature', 'a', {}, at('o', 'r1c1')), inst('TextFeature', 'b', {}, at('o', 'r1c1'))),
    )
    expect(pageNode(r).children[0]!.children[0]!.children.map((n) => n.featureInstanceId)).toEqual(['a', 'b'])
  })

  it('places a child listed before its parent, and warns that it is out of order', () => {
    const r = generate(model(inst('TextFeature', 't', {}, at('c', 'r1c2')), page(), inst('ContainerFeature', 'c', { columns: 2 })))
    expect(r.order).toEqual(['1', 'c', 't'])
    expect(codes(r)).toEqual(['out-of-order:t'])
    expect(r.diagnostics[0]!.message).toBe('Listed before feature c ("ContainerFeature c"), which it is placed in')
    expect(pageNode(r).children[0]!.children[1]!.children.map((n) => n.featureInstanceId)).toEqual(['t'])
  })

  it('supports several pages and non-Page features at the root', () => {
    const r = generate(model(page(), page({ name: 'Second' }, '2'), inst('TextFeature', 't', {}, at(ROOT_ID, 'content'))))
    expect(r.diagnostics).toEqual([])
    expect(r.root.children.map((n) => n.kind)).toEqual(['page', 'page', 'text'])
    expect(r.metadata.pages).toEqual([
      { id: '1', name: 'Page' },
      { id: '2', name: 'Second' },
    ])
  })

  it('keeps children in place when their parent is renamed', () => {
    const before = model(page(), inst('ContainerFeature', 'c', { name: 'Grid', columns: 1 }), inst('TextFeature', 't', {}, at('c', 'r1c1')))
    const renamed = model(before.features[0]!, { ...before.features[1]!, inputs: { ...before.features[1]!.inputs, name: 'Renamed' } }, before.features[2]!)
    const r = generate(renamed)
    expect(r.diagnostics).toEqual([])
    expect(statusOf(r, 't')).toBe('generated')
  })

  it('reports missing and unresolvable placements', () => {
    const r = generate(
      model(
        page(),
        inst('TextFeature', 'none', {}, null),
        inst('TextFeature', 'ghost', {}, at('nobody', 'content')),
        inst('TextFeature', 'badslot', {}, at('1', 'sidebar')),
        inst('TextFeature', 'badroot', {}, at(ROOT_ID, 'header')),
        inst('MapFeature', 'm'),
        inst('TextFeature', 'inmap', {}, at('m', 'body')),
      ),
    )
    expect(r.diagnostics.map((d) => `${d.code}:${d.featureInstanceId}: ${d.message}`)).toEqual([
      'unknown-feature:m: Unknown feature type "MapFeature"',
      'missing-placement:none: Feature has no placement',
      'unresolved-placement:ghost: Parent feature nobody does not exist',
      'unresolved-placement:badslot: Parent feature 1 ("Page") has no slot "sidebar"',
      'unresolved-placement:badroot: The document root has no slot "header"',
      'unresolved-placement:inmap: Parent feature m is not a known feature type',
    ])
    expect(r.metadata.features.filter((f) => f.status === 'skipped').map((f) => f.id)).toEqual(['none', 'ghost', 'badslot', 'badroot', 'inmap'])
  })

  it('ignores placement on features that are not placed', () => {
    const r = generate(model(page(), { ...resource('r'), placement: at('1', 'content') }))
    expect(codes(r)).toEqual(['placement-ignored:r'])
    expect(statusOf(r, 'r')).toBe('generated')
    expect(pageNode(r).children).toEqual([])
  })
})

describe('suppression and skipping', () => {
  it('suppresses disabled features and everything placed inside them, at any depth', () => {
    const r = generate(
      model(
        page(),
        inst('ContainerFeature', 'g', { disable: true, columns: 1 }),
        inst('ContainerFeature', 'p', { columns: 1 }, at('g', 'r1c1')),
        inst('TextFeature', 't', {}, at('p', 'r1c1')),
        inst('TextFeature', 'other'),
      ),
    )
    expect(codes(r)).toEqual(['suppressed:g', 'suppressed:p', 'suppressed:t'])
    expect(pageNode(r).children.map((n) => n.featureInstanceId)).toEqual(['other'])
  })

  it('treats only boolean true as disabled', () => {
    expect(codes(generate(model(page(), inst('TextFeature', 't', { disable: 'true' }))))).toEqual([])
  })

  it('reports placement cycles and skips features behind them', () => {
    const r = generate(
      model(
        page(),
        inst('ContainerFeature', 'a', { columns: 1 }, at('b', 'r1c1')),
        inst('ContainerFeature', 'b', { columns: 1 }, at('a', 'r1c1')),
        inst('TextFeature', 't', {}, at('b', 'r1c1')),
      ),
    )
    expect(codes(r)).toEqual(['cycle:a', 'cycle:b', 'dependency-skipped:t', 'out-of-order:a'])
  })

  it('reports a feature placed inside itself', () => {
    expect(codes(generate(model(page(), inst('ContainerFeature', 'a', { columns: 1 }, at('a', 'r1c1')))))).toEqual(['cycle:a'])
  })

  it('reports duplicate instance ids', () => {
    const r = generate(model(page(), inst('TextFeature', '1')))
    expect(codes(r)).toEqual(['duplicate-id:1'])
    expect(r.root.children).toHaveLength(1)
  })
})

describe('references', () => {
  const table = (id: string, inputs: Record<string, string | string[]> = {}, placement = at('1', 'content')) =>
    inst('TableFeature', id, { data_resource: 'r', fields: ['name'], ...inputs }, placement)

  it('lets a feature read another feature through a reference input', () => {
    const r = generate(model(page(), resource('r'), table('t')))
    expect(r.diagnostics).toEqual([])
    expect(pageNode(r).children[0]!.props).toEqual({
      source: { feature: 'r', resource: 'Repos', operation: 'GET /users/me/repos', endPoint: 'https://api.example.com/users/me/repos' },
      columns: [{ field: 'name', label: 'name' }],
    })
    expect(r.metadata.features.find((f) => f.id === 't')?.references).toEqual(['r'])
    expect(r.edgeKinds.get('r->t')).toBe('reference')
  })

  it('regenerates referencing features when a resource changes', () => {
    const r = generate(model(page(), resource('r'), table('t'), inst('TextFeature', 'x')))
    expect(dependentsOf(r.graph, 'r')).toEqual(['t'])
  })

  it('suppresses features that reference a suppressed feature', () => {
    const r = generate(model(page(), { ...resource('r'), inputs: { ...resource('r').inputs, disable: true } }, table('t')))
    expect(r.diagnostics.map((d) => `${d.code}:${d.featureInstanceId}: ${d.message}`)).toEqual([
      'suppressed:r: Feature is suppressed',
      'suppressed:t: Referenced feature r ("Repos") is suppressed',
    ])
  })

  it('skips features whose reference is missing, of the wrong type, or empty when required', () => {
    const r = generate(
      model(page(), inst('TextFeature', 'txt'), table('missing', { data_resource: 'nope' }), table('wrong', { data_resource: 'txt' }), table('empty', { data_resource: '' })),
    )
    expect(r.diagnostics.map((d) => `${d.code}:${d.featureInstanceId}: ${d.message}`)).toEqual([
      'unresolved-reference:missing: Input "data_resource" references feature nope, which does not exist',
      'unresolved-reference:wrong: Input "data_resource" must reference one of DataResourceFeature, SwaggerDataResourceFeature, not TextFeature',
      'unresolved-reference:empty: No Data Resource selected',
    ])
  })

  it('warns when a feature is listed before a feature it references', () => {
    const r = generate(model(page(), table('t'), resource('r')))
    expect(r.diagnostics.map((d) => d.message)).toEqual(['Listed before feature r ("Repos"), which it references'])
    expect(statusOf(r, 't')).toBe('generated')
  })

  it('passes feature-reported problems through as diagnostics', () => {
    const r = generate(model(page(), resource('r'), table('t', { operation: 'POST /nope' })))
    expect(r.diagnostics).toEqual([{ code: 'feature', severity: 'warning', featureInstanceId: 't', message: 'Operation "POST /nope" is not provided by Repos' }])
  })
})

describe('metadata', () => {
  it('records pages, placements, slots and drop targets', () => {
    const r = generate(model(page(), inst('ContainerFeature', 'c', { name: 'Grid', rows: 1, columns: 2 }), inst('TextFeature', 't', {}, at('c', 'r1c1'))))
    expect(r.metadata.features[2]).toEqual({
      id: 't',
      feature: 'TextFeature',
      name: 'TextFeature t',
      status: 'generated',
      placement: { parent: 'c', slot: 'r1c1' },
      slots: [],
      references: [],
      page: '1',
    })
    expect(r.metadata.targets).toEqual([
      { parent: ROOT_ID, slot: 'content', label: 'Document' },
      { parent: '1', slot: 'content', label: 'Page › content' },
      { parent: 'c', slot: 'r1c1', label: 'Grid › r1c1' },
      { parent: 'c', slot: 'r1c2', label: 'Grid › r1c2' },
    ])
  })

  it('includes every known feature in the graph, even unplaceable ones', () => {
    const r = generate(model(page(), inst('ContainerFeature', 'lost', { columns: 1 }, at('nobody', 'x')), inst('TextFeature', 't', {}, at('lost', 'r1c1'))))
    expect(codes(r)).toEqual(['unresolved-placement:lost', 'parent-skipped:t'])
    expect(r.graph.nodes).toEqual(['1', 'lost', 't'])
    expect(dependentsOf(r.graph, 'lost')).toEqual(['t'])
  })

  it('reflects a parameter change throughout the document', () => {
    const grid = (columns: number) => generate(model(page(), inst('ContainerFeature', 'c', { columns })))
    expect(grid(1).metadata.targets).toHaveLength(3)
    expect(grid(3).metadata.targets).toHaveLength(5)
  })
})

describe('purity', () => {
  it('does not mutate the model and is deterministic', () => {
    const m = deepFreeze(model(page({ border_color: 'red' }), resource('r'), inst('ContainerFeature', 'c'), inst('TableFeature', 't', { data_resource: 'r' }, at('c', 'r1c1'))))
    expect(generate(m)).toEqual(generate(m))
  })
})

describe('custom features', () => {
  const stub = (def: Partial<FeatureDefinition> & Pick<FeatureDefinition, 'type' | 'generate'>): FeatureDefinition => ({
    name: def.type,
    icon: 'box',
    inputs: [],
    placement: 'required',
    ...def,
  })
  const registry = (...defs: FeatureDefinition[]) => createRegistry([...defaultRegistry.values(), ...defs])

  it('skips children of a slot the parent declared but did not generate', () => {
    const broken = stub({ type: 'Broken', slots: () => ['hole'], generate: (_, ctx) => ({ node: node('text', ctx.nodeId(), { text: '' }) }) })
    const r = generate(model(page(), inst('Broken', 'b'), inst('TextFeature', 't', {}, at('b', 'hole'))), registry(broken))
    expect(codes(r)).toEqual(['missing-slot:b', 'parent-skipped:t'])
    expect(statusOf(r, 't')).toBe('skipped')
  })

  it('skips placed features that generate no node, or clashing node ids', () => {
    const empty = stub({ type: 'Empty', generate: () => ({}) })
    const clash = stub({ type: 'Clash', generate: () => ({ node: node('text', '1', { text: '' }) }) })
    const r = generate(model(page(), inst('Empty', 'e'), inst('Clash', 'k')), registry(empty, clash))
    expect(codes(r)).toEqual(['missing-node:e', 'duplicate-node-id:k'])
  })

  it('never mutates nodes returned by features', () => {
    const shared = deepFreeze(node('text', 'shared', { text: '' }, { slot: 's' }))
    const holder = stub({ type: 'Holder', slots: () => ['s'], generate: () => ({ node: shared }) })
    const m = model(page(), inst('Holder', 'h'), inst('TextFeature', 't', {}, at('h', 's')))
    const first = generate(m, registry(holder))
    expect(codes(first)).toEqual([])
    expect(generate(m, registry(holder)).root).toEqual(first.root)
    expect(shared.children).toEqual([])
  })

  it('resolves dependencies declared through dependencies(), and reports undeclared reads', () => {
    const reader = stub({
      type: 'Reader',
      dependencies: () => ['r'],
      generate: (_, ctx) => ({ node: node('text', ctx.nodeId(), { text: `${ctx.resolve('r')?.name}/${ctx.resolve('x')?.name}` }) }),
    })
    const r = generate(model(page(), resource('r'), resource('x', 'Other'), inst('Reader', 'rd')), registry(reader))
    expect(codes(r)).toEqual(['undeclared-dependency:rd'])
    expect(pageNode(r).children[0]!.props).toEqual({ text: 'Repos/undefined' })
  })

  it('freezes exports so consumers cannot change them', () => {
    const writer = stub({
      type: 'Writer',
      dependencies: () => ['r'],
      generate: (_, ctx) => {
        const exports = ctx.resolve('r')!.exports as Record<string, unknown>
        exports.resource = 'hacked'
        return { node: node('text', ctx.nodeId(), { text: '' }) }
      },
    })
    const r = generate(model(page(), resource('r'), inst('Writer', 'w')), registry(writer))
    expect(codes(r)).toEqual(['feature-error:w'])
    expect(statusOf(r, 'w')).toBe('skipped')
  })

  it('turns an exception in a feature into a diagnostic and keeps generating the rest', () => {
    const bomb = stub({ type: 'Bomb', generate: () => { throw new Error('boom') } })
    const r = generate(model(page(), inst('Bomb', 'b'), inst('TextFeature', 't')), registry(bomb))
    expect(r.diagnostics).toEqual([{ code: 'feature-error', severity: 'error', featureInstanceId: 'b', message: 'Feature threw during generation: boom' }])
    expect(statusOf(r, 't')).toBe('generated')
  })
})
