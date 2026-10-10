import { describe, expect, it } from 'vitest'
import {
  createFeatureInstance,
  createRegistry,
  DataResourceFeature,
  defaultRegistry,
  dependentsOf,
  disableInput,
  generate,
  node,
  renderOutline,
  ROOT_ID,
  TableFeature,
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
          heading #3 [3] {"text":"b","level":1,"align":"center"}"
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
    // Core data resources can't be disabled, so use one that declares a `disable` input.
    const Disableable: FeatureDefinition = { ...DataResourceFeature, inputs: [...DataResourceFeature.inputs, disableInput] }
    const registry = createRegistry([...defaultRegistry.values()].map((d) => (d.type === 'DataResourceFeature' ? Disableable : d)))
    const r = generate(model(page(), { ...resource('r'), inputs: { ...resource('r').inputs, disable: true } }, table('t')), registry)
    expect(r.diagnostics.map((d) => `${d.code}:${d.featureInstanceId}: ${d.message}`)).toEqual([
      'suppressed:r: Feature is suppressed',
      'suppressed:t: Referenced feature r ("Repos") is suppressed',
    ])
  })

  it('ignores a stored disable on features that do not declare one (e.g. data resources, themes)', () => {
    const r = generate(model(page(), { ...resource('r'), inputs: { ...resource('r').inputs, disable: true } }, table('t')))
    expect(r.diagnostics).toEqual([])
    expect(r.metadata.features.find((f) => f.id === 'r')).toMatchObject({ status: 'generated' })
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

  it('reads numeric reference values as instance ids', () => {
    const r = generate(model(page(), resource('23'), inst('TableFeature', 't', { data_resource: 23 })))
    expect(r.diagnostics).toEqual([])
    expect(r.metadata.features.find((f) => f.id === 't')?.references).toEqual(['23'])
  })

  it('reports a Table fresh from the palette until a data resource is chosen', () => {
    const r = generate(model(page(), createFeatureInstance(TableFeature, 't', at('1', 'content'))))
    expect(r.diagnostics).toEqual([{ code: 'unresolved-reference', severity: 'error', featureInstanceId: 't', message: 'No Data Resource selected' }])
    expect(statusOf(r, 't')).toBe('skipped')
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
    expect(r.metadata.targets.filter((t) => t.parent === 'b')).toEqual([])
  })

  it('skips placed features that generate no node', () => {
    const empty = stub({ type: 'Empty', generate: () => ({}) })
    expect(codes(generate(model(page(), inst('Empty', 'e')), registry(empty)))).toEqual(['missing-node:e'])
  })

  it('blames a feature that emits node ids it does not own, without harming the owner', () => {
    // Listed first and placed at the root, so it generates before Page "1" whose id it steals.
    const thief = stub({ type: 'Thief', generate: () => ({ node: node('text', '1', { text: '' }) }) })
    const r = generate(model(inst('Thief', 'k', {}, at(ROOT_ID, 'content')), page(), inst('TextFeature', 't')), registry(thief))
    expect(r.diagnostics.map((d) => `${d.code}:${d.featureInstanceId}: ${d.message}`)).toEqual([
      'invalid-node-id:k: Generated node id "1" is not owned by this feature (use ctx.nodeId)',
    ])
    expect(statusOf(r, '1')).toBe('generated')
    expect(statusOf(r, 't')).toBe('generated')
  })

  it('skips a feature whose own node ids repeat', () => {
    const twins = stub({ type: 'Twins', generate: (_, ctx) => ({ node: node('text', ctx.nodeId(), { text: '' }, { children: [node('text', ctx.nodeId('a'), { text: '' }), node('text', ctx.nodeId('a'), { text: '' })] }) }) })
    expect(codes(generate(model(page(), inst('Twins', 'w')), registry(twins)))).toEqual(['duplicate-node-id:w'])
  })

  it('turns exceptions in slots() and dependencies() into diagnostics', () => {
    const badSlots = stub({ type: 'BadSlots', slots: () => { throw new Error('slots boom') }, generate: (_, ctx) => ({ node: node('text', ctx.nodeId(), { text: '' }) }) })
    const badDeps = stub({ type: 'BadDeps', dependencies: () => { throw new Error('deps boom') }, generate: (_, ctx) => ({ node: node('text', ctx.nodeId(), { text: '' }) }) })
    const r = generate(model(page(), inst('BadSlots', 's'), inst('TextFeature', 'in', {}, at('s', 'x')), inst('BadDeps', 'd'), inst('TextFeature', 'ok')), registry(badSlots, badDeps))
    expect(r.diagnostics.map((d) => `${d.code}:${d.featureInstanceId}: ${d.message}`)).toEqual([
      'feature-error:s: Feature threw in slots(): slots boom',
      'unresolved-placement:in: Parent feature s ("BadSlots s") has no slot "x"',
      'feature-error:d: Feature threw in dependencies(): deps boom',
    ])
    expect(statusOf(r, 'ok')).toBe('generated')
  })

  it('never mutates nodes returned by features', () => {
    const shared = deepFreeze(node('text', 'h', { text: '' }, { slot: 's' }))
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

  it('deep-freezes exports so one consumer cannot change what another reads', () => {
    const pusher = stub({
      type: 'Pusher',
      dependencies: () => ['r'],
      generate: (_, ctx) => {
        ;(ctx.resolve('r')!.exports.operations as unknown[]).push({ name: 'POST /evil', method: 'POST', endPoint: 'x' })
        return { node: node('text', ctx.nodeId(), { text: '' }) }
      },
    })
    const r = generate(model(page(), resource('r'), inst('Pusher', 'p'), inst('TableFeature', 't', { data_resource: 'r', operation: 'POST /evil' })), registry(pusher))
    expect(codes(r)).toEqual(['feature-error:p', 'feature:t'])
    expect(r.diagnostics[1]!.message).toBe('Operation "POST /evil" is not provided by Repos')
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

describe('placeholders (editor mode)', () => {
  const m = model(
    page(),
    inst('MapFeature', 'map'),
    inst('TableFeature', 'tbl', { data_resource: '' }),
    inst('TextFeature', 'off', { disable: true }),
    inst('MapFeature', 'lost', {}, at('nowhere', 'x')),
    inst('TextFeature', 'ok'),
  )

  it('are off by default', () => {
    expect(pageNode(generate(m)).children.map((n) => n.featureInstanceId)).toEqual(['ok'])
  })

  it('stand in for unknown and skipped placed features, in model order, but not suppressed or unplaceable ones', () => {
    const r = generate(m, defaultRegistry, { placeholders: true })
    const children = pageNode(r).children
    expect(children.map((n) => [n.featureInstanceId, n.kind])).toEqual([
      ['map', 'placeholder'],
      ['tbl', 'placeholder'],
      ['ok', 'text'],
    ])
    expect(children[0]).toEqual({
      id: 'map',
      kind: 'placeholder',
      featureInstanceId: 'map',
      props: { feature: 'MapFeature', name: 'MapFeature map', status: 'unknown', reason: 'MapFeature is not ported yet' },
      children: [],
    })
    expect(children[1]!.props).toEqual({ feature: 'TableFeature', name: 'TableFeature tbl', status: 'skipped', reason: 'No Data Resource selected' })
  })

  it('do not change diagnostics, metadata targets or statuses', () => {
    const plain = generate(m)
    const editor = generate(m, defaultRegistry, { placeholders: true })
    expect(editor.diagnostics).toEqual(plain.diagnostics)
    expect(editor.metadata).toEqual(plain.metadata)
  })
})

describe('skip reasons in metadata', () => {
  it('record the first problem, not later effects such as out-of-order', () => {
    // t is listed before its container c, and c itself cannot be placed.
    const r = generate(model(page(), inst('TextFeature', 't', {}, at('c', 'r1c1')), inst('ContainerFeature', 'c', { columns: 1 }, at('nowhere', 'x')), inst('TextFeature', 'off', { disable: true })))
    expect(r.diagnostics.filter((d) => d.featureInstanceId === 't').map((d) => d.code)).toEqual(['out-of-order', 'parent-skipped'])
    const reasons = Object.fromEntries(r.metadata.features.map((f) => [f.id, f.reason]))
    expect(reasons).toEqual({
      '1': undefined,
      t: 'Parent feature c ("ContainerFeature c") was not generated',
      c: 'Parent feature nowhere does not exist',
      off: 'Feature is suppressed',
    })
  })
})

describe('unknown features in metadata', () => {
  it('are listed in model order with status unknown, their placement and page', () => {
    const r = generate(model(page(), inst('TextFeature', 'a'), inst('MapFeature', 'map'), inst('TextFeature', 'b')))
    expect(r.metadata.features.map((f) => `${f.id}:${f.status}`)).toEqual(['1:generated', 'a:generated', 'map:unknown', 'b:generated'])
    expect(r.metadata.features[2]).toEqual({
      id: 'map',
      feature: 'MapFeature',
      name: 'MapFeature map',
      status: 'unknown',
      reason: 'MapFeature is not ported yet',
      placement: at('1', 'content'),
      page: '1',
      slots: [],
      references: [],
    })
  })
})
