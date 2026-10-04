import { describe, expect, it, vi } from 'vitest'
import {
  ContainerFeature,
  coreFeatures,
  DataResourceFeature,
  defaultInputs,
  HeaderFeature,
  ImageFeature,
  PageFeature,
  PanelFeature,
  pathname,
  TableFeature,
  TextFeature,
  walkNodes,
  type DataResourceExports,
  type DocNode,
  type FeatureContext,
  type FeatureDefinition,
  type ResolvedFeature,
} from '../src'

function context(resolve: (id: string) => ResolvedFeature | undefined = () => undefined) {
  const report = vi.fn<FeatureContext['report']>()
  const ctx: FeatureContext = { instanceId: '7', nodeId: (part) => (part === undefined ? '7' : `7.${part}`), resolve, report }
  return { ctx, report }
}

/** Runs a feature as a newly created instance would: defaults, overridden by `raw`. */
function run(def: FeatureDefinition, raw: Record<string, unknown> = {}, resolve?: (id: string) => ResolvedFeature | undefined) {
  const inputs = { ...defaultInputs(def.inputs), ...raw } as Parameters<FeatureDefinition['generate']>[0]
  const { ctx, report } = context(resolve)
  return { out: def.generate(inputs, ctx), slots: def.slots?.(inputs) ?? [], report }
}

const allNodes = (root: DocNode) => {
  const nodes: DocNode[] = []
  walkNodes(root, (n) => nodes.push(n))
  return nodes
}

describe.each(coreFeatures.map((f) => [f.type, f] as const))('%s contract', (_, def) => {
  it('declares unique input names, valid defaults, and no legacy page_location input', () => {
    const names = def.inputs.map((i) => i.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).not.toContain('page_location')
    for (const input of def.inputs) {
      if (input.options && input.default !== undefined) expect(input.options.map((o) => o.value), input.name).toContain(input.default)
    }
  })

  it('is deterministic', () => {
    expect(run(def).out).toEqual(run(def).out)
  })

  if (def.placement === 'required') {
    it('generates a node with ids owned by the instance and every declared slot', () => {
      const { out, slots } = run(def)
      expect(out.node).toBeDefined()
      const nodes = allNodes(out.node!)
      const ids = nodes.map((n) => n.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const id of ids) expect(id === '7' || id.startsWith('7.'), id).toBe(true)
      const generatedSlots = nodes.flatMap((n) => (n.slot === undefined ? [] : [n.slot]))
      expect(generatedSlots).toEqual(slots)
    })
  } else {
    it('generates exports and no node', () => {
      const { out } = run(def)
      expect(out.node).toBeUndefined()
      expect(out.exports).toBeDefined()
    })
  }
})

describe('PageFeature', () => {
  it('is itself the content slot', () => {
    expect(run(PageFeature).out.node).toMatchObject({ kind: 'page', id: '7', slot: 'content' })
  })

  it('turns colour inputs into style', () => {
    const { out } = run(PageFeature, { border_color: '#00a3ff', background_color: '#e6fcfc', background_image: 'a.png' })
    expect(out.node?.style).toEqual({
      border: '5px solid #00a3ff',
      borderRadius: '5px',
      padding: '8px',
      backgroundColor: '#e6fcfc',
      backgroundImage: 'url("a.png")',
    })
  })

  it('omits style when no style inputs are set', () => {
    expect(run(PageFeature).out.node?.style).toBeUndefined()
  })
})

describe('TextFeature', () => {
  it('emits a text node with the default text', () => {
    expect(run(TextFeature).out.node).toEqual({
      id: '7',
      kind: 'text',
      props: { text: 'Lorem ipsum dolor sit amet, consectetur adipisicing elit' },
      children: [],
    })
  })
})

describe('HeaderFeature', () => {
  it('defaults new instances to centred info level-1 headings', () => {
    expect(run(HeaderFeature).out.node?.props).toEqual({ text: 'Enter your header text here', level: 1, align: 'center', tone: 'info', background: undefined })
  })

  it('reads plain v2 values', () => {
    const { out } = run(HeaderFeature, { text: 'Hi', size: 3, align: 'left', text_style: 'success', background: 'info' })
    expect(out.node?.props).toEqual({ text: 'Hi', level: 3, align: 'left', tone: 'success', background: 'info' })
  })

  it('clamps the level and ignores unknown values', () => {
    expect(run(HeaderFeature, { size: 9 }).out.node?.props).toMatchObject({ level: 6 })
    expect(run(HeaderFeature, { size: 0, align: 'text-left', text_style: 'text-info' }).out.node?.props).toMatchObject({ level: 1, align: 'center', tone: undefined })
  })
})

describe('ImageFeature', () => {
  it('reads plain v2 values', () => {
    const { out } = run(ImageFeature, { src: 'x.jpg', alt: 'x', align: 'right', responsive: true, width: '100%' })
    expect(out.node?.props).toEqual({ src: 'x.jpg', alt: 'x', width: '100%', height: '200', responsive: true, align: 'right' })
  })

  it('treats only boolean true as responsive', () => {
    expect(run(ImageFeature, { responsive: 'true' }).out.node?.props).toMatchObject({ responsive: false })
  })
})

describe('ContainerFeature', () => {
  it('creates rows x columns cell slots', () => {
    const { out, slots } = run(ContainerFeature, { rows: 2, columns: 3 })
    expect(out.node?.props).toEqual({ rows: 2, columns: 3, well: true })
    expect(slots).toEqual(['r1c1', 'r1c2', 'r1c3', 'r2c1', 'r2c2', 'r2c3'])
    expect(out.node?.children.map((c) => [c.id, c.slot])).toContainEqual(['7.r2c3', 'r2c3'])
  })

  it('clamps columns to 12 and rows to at least 1', () => {
    expect(run(ContainerFeature, { columns: 40, rows: -2 }).out.node?.props).toMatchObject({ columns: 12, rows: 1 })
  })
})

describe('PanelFeature', () => {
  it('provides a body slot under a heading', () => {
    const { out, slots } = run(PanelFeature, { heading: 'Repos', style: 'success' })
    expect(slots).toEqual(['body'])
    expect(out.node).toEqual({
      id: '7',
      kind: 'panel',
      props: { heading: 'Repos', tone: 'success' },
      children: [{ id: '7.body', kind: 'panel-body', props: {}, slot: 'body', children: [] }],
    })
  })
})

describe('DataResourceFeature', () => {
  it('exports one operation named after its method and path', () => {
    const { out } = run(DataResourceFeature, { name: 'Repos', resource: 'https://api.github.com/users/x/repos?per_page=5', operation: 'GET' })
    expect(out.exports).toEqual({
      resource: 'Repos',
      operations: [{ name: 'GET /users/x/repos', method: 'GET', endPoint: 'https://api.github.com/users/x/repos?per_page=5' }],
      schemas: {},
    })
  })

  it('names operations by URL path, like the legacy app', () => {
    expect(['https://h/a/b?x=1#f', 'https://h', 'https://h?q', 'HTTP://h/A', '/local?x', 'rel/path'].map(pathname)).toEqual(['/a/b', '/', '/', '/A', '/local', 'rel/path'])
  })

  it('falls back to GET and tolerates non-URL resources', () => {
    const { out } = run(DataResourceFeature, { resource: '/local/data', operation: 'FETCH' })
    expect((out.exports as unknown as DataResourceExports).operations[0]).toMatchObject({ name: 'GET /local/data', method: 'GET' })
  })
})

describe('TableFeature', () => {
  const exportsOf = (overrides: Partial<DataResourceExports> = {}): DataResourceExports => ({
    resource: 'Repos',
    operations: [
      { name: 'GET /repos', method: 'GET', endPoint: 'https://api/repos' },
      { name: 'DELETE /repos/{id}', method: 'DELETE', endPoint: 'https://api/repos/{id}' },
    ],
    schemas: {},
    ...overrides,
  })
  const resolveTo = (exports: unknown) => (id: string) => (id === 'r' ? { id, feature: 'DataResourceFeature', name: 'Repos', exports: exports as Record<string, unknown> } : undefined)

  it('reads its source operation from the referenced resource', () => {
    const { out, report } = run(
      TableFeature,
      { data_resource: 'r', operation: 'GET /repos', fields: ['name', 'language'], labels: ['Name'], filters: ['uppercase', ''] },
      resolveTo(exportsOf()),
    )
    expect(out.node?.props).toEqual({
      source: { feature: 'r', resource: 'Repos', operation: 'GET /repos', endPoint: 'https://api/repos' },
      columns: [
        { field: 'name', label: 'Name', filter: 'uppercase' },
        { field: 'language', label: 'language' },
      ],
    })
    expect(report).not.toHaveBeenCalled()
  })

  it('uses the first operation when none is chosen, and adds a delete action', () => {
    const { out } = run(TableFeature, { data_resource: 'r', delete_operation: 'DELETE /repos/{id}' }, resolveTo(exportsOf()))
    expect(out.node?.props).toMatchObject({
      source: { operation: 'GET /repos' },
      deleteAction: { operation: 'DELETE /repos/{id}', endPoint: 'https://api/repos/{id}' },
    })
  })

  it('derives the row path and columns from the response schema', () => {
    const exports = exportsOf({
      operations: [{ name: 'GET /v1/sales', method: 'GET', endPoint: 'https://api/v1/sales', responseType: 'SalesList' }],
      schemas: {
        SalesList: { properties: { total: { type: 'integer' }, sales: { type: 'array', items: { $ref: 'Sale' } } } },
        Sale: { properties: { name: { description: 'Name' }, amount: { description: 'Amount' }, id: {} } },
      },
    })
    const { out } = run(TableFeature, { data_resource: 'r', operation: 'GET /v1/sales', fields: ['ignored'] }, resolveTo(exports))
    expect(out.node?.props).toMatchObject({
      source: { path: 'sales' },
      columns: [
        { field: 'name', label: 'Name' },
        { field: 'amount', label: 'Amount' },
        { field: 'id', label: 'id' },
      ],
    })
  })

  it('reports operations the resource does not provide', () => {
    const { out, report } = run(TableFeature, { data_resource: 'r', operation: 'GET /nope', delete_operation: 'DELETE /nope' }, resolveTo(exportsOf()))
    expect(out.node?.props).not.toHaveProperty('source')
    expect(report.mock.calls).toEqual([
      ['warning', 'Operation "GET /nope" is not provided by Repos'],
      ['warning', 'Delete operation "DELETE /nope" is not provided by Repos'],
    ])
  })

  it('reports a resource without data-resource exports', () => {
    const { out, report } = run(TableFeature, { data_resource: 'r' }, resolveTo({}))
    expect(out.node?.kind).toBe('table')
    expect(report).toHaveBeenCalledWith('error', 'Data resource did not export any operations')
  })
})
