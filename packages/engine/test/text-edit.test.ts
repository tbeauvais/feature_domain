import { describe, expect, it } from 'vitest'
import {
  createRegistry,
  defaultRegistry,
  editedValue,
  EditError,
  editText,
  findEditable,
  generate,
  insertedValue,
  insertTextAfter,
  markLocation,
  node,
  walkNodes,
  type DocNode,
  type FeatureDefinition,
  type TextLocation,
} from '../src'
import { at, inst, model, page } from './helpers'

const item = (at: number): TextLocation => ({ feature: '2', input: 'items', kind: 'item', at })
const paragraph = (at: number): TextLocation => ({ feature: '2', input: 'text', kind: 'paragraph', at })
const whole: TextLocation = { feature: '2', input: 'text', kind: 'text' }

describe('editedValue', () => {
  it('replaces a whole input, trimmed, and keeps line breaks only in multi-line inputs', () => {
    expect(editedValue('Old', whole, '  New words ', 'string')).toBe('New words')
    expect(editedValue('Old', whole, 'One\n two', 'string')).toBe('One two')
    expect(editedValue('Old', whole, 'One\ntwo', 'text')).toBe('One\ntwo')
    expect(editedValue('Old', whole, '', 'string')).toBe('')
  })

  it('types non-breaking spaces (which browsers put in for repeated and trailing spaces) as plain spaces', () => {
    expect(editedValue('Old', whole, 'Hello\u00a0 world\u00a0', 'string')).toBe('Hello  world')
    expect(editedValue(['a'], item(0), '\u00a0b\u00a0c', 'list')).toEqual(['b c'])
    expect(editedValue('A', paragraph(0), 'x\u00a0y', 'text')).toBe('x y')
    expect(editedValue('Same', whole, 'Same\u00a0', 'string')).toBe('Same')
  })

  it('changes nothing when the text is what the page shows', () => {
    expect(editedValue('  Same\n', whole, 'Same', 'string')).toBe('  Same\n')
    expect(editedValue(['a', ' b '], item(1), 'b', 'list')).toEqual(['a', ' b '])
    expect(editedValue('A\n\n B ', paragraph(1), 'B', 'text')).toBe('A\n\n B ')
  })

  it('replaces one list entry, and removes it when emptied', () => {
    expect(editedValue(['a', 'b', 'c'], item(1), 'B\nb', 'list')).toEqual(['a', 'B b', 'c'])
    expect(editedValue(['a', 'b', 'c'], item(1), '  ', 'list')).toEqual(['a', 'c'])
    expect(() => editedValue(['a'], item(3), 'x', 'list')).toThrow(EditError)
  })

  it('replaces one paragraph in place, keeping the others and their breaks as written', () => {
    const text = 'First\n\n\n  \nSecond\nstill second\n\nThird'
    expect(editedValue(text, paragraph(1), 'Two', 'text')).toBe('First\n\n\n  \nTwo\n\nThird')
    expect(editedValue(text, paragraph(2), 'Three', 'text')).toBe('First\n\n\n  \nSecond\nstill second\n\nThree')
    // A paragraph stays one paragraph: pasted blank lines become line breaks, so the paragraphs after it keep their place.
    expect(editedValue('A\n\nB', paragraph(0), 'A1\n\n \nA2', 'text')).toBe('A1\nA2\n\nB')
    expect(() => editedValue('A', paragraph(1), 'x', 'text')).toThrow(EditError)
  })

  it('removes an emptied paragraph with one of its breaks', () => {
    expect(editedValue('A\n\nB\n\nC', paragraph(1), '', 'text')).toBe('A\n\nC')
    expect(editedValue('A\n\nB', paragraph(0), '', 'text')).toBe('B')
    expect(editedValue('A\n\nB', paragraph(1), '', 'text')).toBe('A')
    expect(editedValue('A', paragraph(0), '', 'text')).toBe('')
  })

  it('counts paragraphs as the page does, skipping blank leading text', () => {
    expect(editedValue('\n\n  \n\nA\n\nB', paragraph(0), 'X', 'text')).toBe('\n\n  \n\nX\n\nB')
  })
})

describe('insertedValue', () => {
  it('adds a list entry after the given one', () => {
    expect(insertedValue(['a', 'b'], item(0), 'New item')).toEqual({ value: ['a', 'New item', 'b'], at: 1 })
    expect(insertedValue(['a', 'b'], item(1), 'x\ny')).toEqual({ value: ['a', 'b', 'x y'], at: 2 })
  })

  it('adds a paragraph after the given one', () => {
    expect(insertedValue('A\n\nB', paragraph(0), 'New')).toEqual({ value: 'A\n\nNew\n\nB', at: 1 })
    expect(insertedValue('A', paragraph(0), 'x\n\ny')).toEqual({ value: 'A\n\nx\ny', at: 1 })
    expect(insertedValue('A\n\nB', paragraph(1), 'New')).toEqual({ value: 'A\n\nB\n\nNew', at: 2 })
  })

  it('refuses whole inputs and missing entries', () => {
    expect(() => insertedValue('A', whole, 'x')).toThrow(EditError)
    expect(() => insertedValue([], item(0), 'x')).toThrow(EditError)
    expect(() => insertedValue('', paragraph(0), 'x')).toThrow(EditError)
  })
})

describe('editText and insertTextAfter', () => {
  const m = model(page(), inst('TextWithParagraphFeature', '2', { title: 'T', text: 'A\n\nB' }), inst('ListFeature', '3', { items: ['x', 'y'] }))

  it('write the edit into the input, as a new model', () => {
    const next = editText(m, paragraph(1), 'Bee')
    expect(next.features[1]!.inputs.text).toBe('A\n\nBee')
    expect(m.features[1]!.inputs.text).toBe('A\n\nB')
  })

  it('return the same model when nothing changes', () => {
    expect(editText(m, paragraph(1), ' B ')).toBe(m)
  })

  it('edit an input the instance doesn’t store yet, from its default', () => {
    const bare = model(page(), { feature: 'ListFeature', id: '2', inputs: {}, placement: at('1', 'content') })
    expect(editText(bare, item(0), 'Crimson').features[1]!.inputs.items).toEqual(['Crimson', 'Green', 'Blue'])
  })

  it('refuse missing features and inputs', () => {
    expect(() => editText(m, { ...whole, feature: '9' }, 'x')).toThrow(EditError)
    expect(() => editText(m, { ...whole, input: 'nope' }, 'x')).toThrow(EditError)
  })

  it('add after an entry and say where the new one is shown', () => {
    const { model: next, location } = insertTextAfter(m, { feature: '3', input: 'items', kind: 'item', at: 0 }, 'New item')
    expect(next.features[2]!.inputs.items).toEqual(['x', 'New item', 'y'])
    const found = findEditable(generate(next).root, location)
    expect(found && found.item).toBe(1)
  })
})

describe('findEditable', () => {
  it('finds marked text by its location in the generated page', () => {
    const m = model(page(), inst('PanelFeature', '2', { heading: 'Repos' }), inst('ListGroupFeature', '3', { items: ['a', '', 'c'] }, at('2', 'body')))
    const root = generate(m).root
    expect(findEditable(root, { feature: '2', input: 'heading', kind: 'text' })).toMatchObject({ node: { id: '2' }, prop: 'heading' })
    // The empty entry isn't shown, so entry 2 is the list's second item.
    expect(findEditable(root, { feature: '3', input: 'items', kind: 'item', at: 2 })).toMatchObject({ node: { id: '3.items' }, prop: 'items', item: 1 })
    expect(findEditable(root, { feature: '3', input: 'items', kind: 'item', at: 1 })).toBeUndefined()
    // The panel's heading belongs to the panel, not to features placed inside it.
    expect(findEditable(root, { feature: '3', input: 'heading', kind: 'text' })).toMatchObject({ node: { id: '3.heading' } })
  })

  it('maps every mark in a sample back to the same text', () => {
    const m = model(page(), inst('TextWithParagraphFeature', '2', { title: 'T', text: 'A\n\nB' }), inst('HeaderFeature', '3', { text: 'Hi' }))
    const root = generate(m).root
    const seen: string[] = []
    const visit = (n: DocNode, owner: string | undefined) => {
      const own = n.featureInstanceId ?? owner
      for (const [prop, mark] of Object.entries(n.edit ?? {})) {
        const location = markLocation(own!, mark, 0)!
        expect(findEditable(root, location)?.node).toBe(n)
        seen.push(`${n.id}.${prop}`)
      }
      for (const c of n.children) visit(c, own)
    }
    visit(root, undefined)
    expect(seen).toEqual(['2.title.text', '2.p1.text', '2.p2.text', '3.text'])
  })
})

describe('edit marks', () => {
  it('are on the text of the features that show their inputs as written', () => {
    const m = model(
      page(),
      inst('HeaderFeature', '2'),
      inst('PanelFeature', '3'),
      inst('ListFeature', '4'),
      inst('ListGroupFeature', '5'),
      inst('TextFeature', '6'),
      inst('TextWithParagraphFeature', '7'),
      inst('ImageWithParagraphFeature', '8'),
      inst('LinkFeature', '9'),
      inst('ButtonFeature', '10'),
      inst('GoogleMapFeature', '11', { title: 'Find us' }),
      inst('WeatherFeature', '12', { title: 'Here' }),
    )
    const marks: string[] = []
    walkNodes(generate(m).root, (n) => {
      for (const [prop, mark] of Object.entries(n.edit ?? {})) marks.push(`${n.id}.${prop}=${mark.input}`)
    })
    expect(marks).toEqual([
      '2.text=text',
      '3.heading=heading',
      '4.items=items',
      '5.heading.text=heading',
      '5.description.text=description',
      '5.items.items=items',
      '5.highlight.text=highlight',
      '6.text=text',
      '7.title.text=title',
      '7.p1.text=text',
      '8.title.text=title',
      '8.p1.text=text',
      '9.text=text',
      '10.text=text',
      '11.title.text=title',
      '11.address.text=address',
      '12.title.text=title',
    ])
  })

  it('are left off text that isn’t a plain copy of an input', () => {
    // A Weather card without a title of its own shows the place's name; a Text filled in from data shows values.
    const m = model(
      page(),
      inst('WeatherFeature', '2', { title: '', place: 'Guilford' }),
      inst('DataResourceFeature', '3', { name: 'R', source: 'sample' }, null),
      inst('TextFeature', '4', { text: '{{length}} rows', data_resource: '3' }),
    )
    const r = generate(m)
    const marked: string[] = []
    walkNodes(r.root, (n) => n.edit && marked.push(n.id))
    expect(marked).toEqual([])
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })

  it('that name inputs the feature doesn’t declare, or don’t fit, skip the feature', () => {
    const stub = (type: string, edit: DocNode['edit'], props = { text: 'x' }): FeatureDefinition => ({
      type,
      name: type,
      icon: 'box',
      placement: 'required',
      inputs: [
        { name: 'text', label: 'Text', type: 'string', control: 'text-input' },
        { name: 'items', label: 'Items', type: 'list', control: 'list-input' },
      ],
      generate: (_, ctx) => ({ node: node('paragraph', ctx.nodeId(), props as never, { edit }) }),
    })
    const registry = createRegistry([
      ...defaultRegistry.values(),
      stub('Undeclared', { text: { input: 'title', kind: 'text' } }),
      stub('WrongType', { text: { input: 'items', kind: 'text' } }),
      stub('NotText', { emphasis: { input: 'text', kind: 'text' } }),
      stub('Entries', { text: { input: 'items', kind: 'item', entries: [0] } }),
      stub('Paragraph', { text: { input: 'items', kind: 'paragraph', index: 0 } }),
      stub('Fine', { text: { input: 'text', kind: 'text' } }),
    ])
    const r = generate(
      model(page(), inst('Undeclared', 'a'), inst('WrongType', 'b'), inst('NotText', 'c'), inst('Entries', 'd'), inst('Paragraph', 'f'), inst('Fine', 'e')),
      registry,
    )
    expect(r.diagnostics.map((d) => `${d.code}:${d.featureInstanceId}: ${d.message}`)).toEqual([
      'invalid-edit-mark:a: Node "a" marks its text as input "title", which the feature doesn\'t declare',
      'invalid-edit-mark:b: Node "b" marks its text as text of input "items", a list input',
      'invalid-edit-mark:c: Node "c" marks its emphasis as text of input "text", but its emphasis doesn\'t match',
      'invalid-edit-mark:d: Node "d" marks its text as item of input "items", but its text doesn\'t match',
      'invalid-edit-mark:f: Node "f" marks its text as paragraph of input "items", a list input',
    ])
    expect(r.metadata.features.find((f) => f.id === 'e')?.status).toBe('generated')
  })
})
