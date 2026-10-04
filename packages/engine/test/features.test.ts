import { describe, expect, it } from 'vitest'
import {
  cellId,
  ContainerFeature,
  coreFeatures,
  HeaderFeature,
  ImageFeature,
  indexNodes,
  PageFeature,
  defaultInputs,
  TextFeature,
  type FeatureDefinition,
} from '../src'

const ctx = { instanceId: '7', domId: 'thing_7' }
// Runs a feature as a newly created instance would: defaults, overridden by `raw`.
const run = (def: FeatureDefinition, raw: Record<string, unknown> = {}) => {
  const inputs = { ...defaultInputs(def.inputs), ...raw }
  return { out: def.generate(inputs, ctx), slots: def.slots?.(inputs, ctx) ?? [] }
}

describe.each(coreFeatures.map((f) => [f.type, f] as const))('%s contract', (_, def) => {
  it('generates every slot it declares, with unique node ids', () => {
    const { out, slots } = run(def)
    const ids: string[] = []
    const walk = (n: typeof out) => {
      ids.push(n.id)
      n.children.forEach(walk)
    }
    walk(out)
    expect(new Set(ids).size).toBe(ids.length)
    const index = indexNodes(out)
    for (const slot of slots) expect(index.has(slot)).toBe(true)
  })

  it('is deterministic', () => {
    expect(run(def)).toEqual(run(def))
  })

  it('declares unique input names with a page_location input', () => {
    const names = def.inputs.map((i) => i.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('page_location')
  })
})

describe('PageFeature', () => {
  it('provides the page container', () => {
    expect(run(PageFeature).slots).toEqual(['page_container'])
  })

  it('turns colour inputs into style', () => {
    const { out } = run(PageFeature, { border_color: '#00a3ff', background_color: '#e6fcfc', background_image: 'a.png' })
    expect(out.style).toEqual({
      border: '5px solid #00a3ff',
      borderRadius: '5px',
      padding: '8px',
      backgroundColor: '#e6fcfc',
      backgroundImage: 'url("a.png")',
    })
  })

  it('omits style when no style inputs are set', () => {
    expect(run(PageFeature).out.style).toBeUndefined()
  })
})

describe('TextFeature', () => {
  it('emits a text node with the default text', () => {
    expect(run(TextFeature).out).toEqual({
      id: 'thing_7',
      kind: 'text',
      props: { text: 'Lorem ipsum dolor sit amet, consectetur adipisicing elit' },
      children: [],
    })
  })
})

describe('HeaderFeature', () => {
  it('maps legacy Bootstrap values', () => {
    const { out } = run(HeaderFeature, { text: 'Hi', size: '3', align: 'text-left', text_style: 'text-success', background: 'bg-info' })
    expect(out.props).toEqual({ text: 'Hi', level: 3, align: 'left', tone: 'success', background: 'info' })
  })

  it('treats absent style inputs as unset, like legacy models rendered', () => {
    expect(HeaderFeature.generate({ text: 'Hi' }, ctx).props).toEqual({ text: 'Hi', level: 1, align: 'left', tone: undefined, background: undefined })
  })

  it('defaults new instances to centred info headings', () => {
    expect(run(HeaderFeature).out.props).toMatchObject({ align: 'center', tone: 'info' })
  })

  it('clamps the heading level to 1-6', () => {
    expect(run(HeaderFeature, { size: 9 }).out.props.level).toBe(6)
    expect(run(HeaderFeature, { size: '0' }).out.props.level).toBe(1)
    expect(run(HeaderFeature, { size: 'big' }).out.props.level).toBe(1)
  })
})

describe('ImageFeature', () => {
  it('maps legacy alignment and boolean encodings', () => {
    const { out } = run(ImageFeature, { src: 'x.jpg', alt: 'x', align: 'pull-right', responsive: 'true', width: '100%' })
    expect(out.props).toEqual({ src: 'x.jpg', alt: 'x', width: '100%', height: '200', responsive: true, align: 'right' })
  })
})

describe('ImageFeature absent inputs', () => {
  it('renders left-aligned and not responsive, like legacy models', () => {
    expect(ImageFeature.generate({ src: 'x.jpg' }, ctx).props).toMatchObject({ align: 'left', responsive: false, width: '', height: '' })
  })
})

describe('ContainerFeature', () => {
  it('creates rows x columns cells with legacy target ids', () => {
    const { out, slots } = run(ContainerFeature, { rows: '2', columns: '3' })
    expect(out.props).toEqual({ rows: 2, columns: 3, well: true })
    expect(slots).toHaveLength(6)
    expect(slots[0]).toBe(cellId('thing_7', 1, 1))
    expect(slots[5]).toBe('container_thing_7_row_2_col_3')
    expect(out.children.map((c) => c.id)).toEqual(slots)
  })

  it('clamps columns to 12 and rows to at least 1', () => {
    expect(run(ContainerFeature, { columns: '40', rows: '-2' }).out.props).toMatchObject({ columns: 12, rows: 1 })
  })

  it('has no well when the input is absent, like legacy models', () => {
    expect(ContainerFeature.generate({}, ctx).props).toEqual({ rows: 1, columns: 2, well: false })
  })

  it('respects well=false', () => {
    expect(run(ContainerFeature, { well: false }).out.props.well).toBe(false)
  })
})
