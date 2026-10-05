import { generate, MemoryModelStore, type InputDef } from '@feature-domain/engine'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Inspector from '../src/editor/Inspector.vue'
import InputField from '../src/editor/InputField.vue'
import DocumentView from '../src/renderer/DocumentView.vue'
import { setModelStore } from '../src/services'
import { useDocumentStore } from '../src/stores/document'
import { at, inst, model, page } from './helpers'

const def = (d: Partial<InputDef> & Pick<InputDef, 'type'>): InputDef => ({ name: 'x', label: 'X', control: 'text-input', ...d })
const lastChange = (w: ReturnType<typeof mount>) => (w.emitted('change') as unknown[][] | undefined)?.at(-1)?.[0]

describe('InputField', () => {
  it('edits strings, text areas and lists', async () => {
    const text = mount(InputField, { props: { def: def({ type: 'string', default: 'd' }), value: undefined } })
    expect((text.get('input').element as HTMLInputElement).value).toBe('d')
    await text.get('input').setValue('new')
    expect(lastChange(text)).toBe('new')

    const list = mount(InputField, { props: { def: def({ type: 'list' }), value: ['a', 'b'] } })
    expect((list.get('textarea').element as HTMLTextAreaElement).value).toBe('a\nb')
    await list.get('textarea').setValue(' one \n\ntwo\n')
    expect(lastChange(list)).toEqual(['one', 'two'])
  })

  it('edits numbers, clearing to undefined when empty', async () => {
    const w = mount(InputField, { props: { def: def({ type: 'integer', min: 1, max: 6 }), value: 3 } })
    expect(w.get('input').attributes()).toMatchObject({ type: 'number', min: '1', max: '6' })
    await w.get('input').setValue('5')
    expect(lastChange(w)).toBe(5)
    await w.get('input').setValue('')
    expect(lastChange(w)).toBeUndefined()
  })

  it('edits booleans, options, colours and references', async () => {
    const bool = mount(InputField, { props: { def: def({ type: 'boolean', label: 'On' }), value: false } })
    await bool.get('input').setValue(true)
    expect(lastChange(bool)).toBe(true)

    const select = mount(InputField, { props: { def: def({ type: 'string', options: [{ value: 'a', text: 'A' }, { value: 'b', text: 'B' }] }), value: 'a' } })
    await select.get('select').setValue('b')
    expect(lastChange(select)).toBe('b')

    const color = mount(InputField, { props: { def: def({ type: 'color' }), value: '#00a3ff' } })
    expect((color.get('input[type="color"]').element as HTMLInputElement).value).toBe('#00a3ff')
    await color.get('input[type="text"]').setValue('red')
    expect(lastChange(color)).toBe('red')

    const ref = mount(InputField, { props: { def: def({ type: 'reference' }), value: '', references: [{ id: 'r', label: 'Repos (#r)' }] } })
    expect(ref.findAll('option').map((o) => o.text())).toEqual(['None', 'Repos (#r)'])
    await ref.get('select').setValue('r')
    expect(lastChange(ref)).toBe('r')
  })
})

describe('Inspector', () => {
  beforeEach(() => setActivePinia(createPinia()))

  async function inspect(features: Parameters<typeof model>, selected: string) {
    const store = new MemoryModelStore()
    setModelStore(store)
    const doc = useDocumentStore()
    doc.editing = true
    await doc.load(await store.create(model(...features)))
    doc.select(selected)
    return { doc, w: mount(Inspector) }
  }

  it('shows the selected feature’s inputs and applies edits live', async () => {
    const { doc, w } = await inspect([page(), inst('HeaderFeature', 'h', { text: 'Hi' })], 'h')
    expect(w.text()).toContain('Header #h')
    expect(w.findAll('label').map((l) => l.text())).toContain('Text Style')
    await w.get('#input-text').setValue('Hello')
    expect(doc.result?.root.children[0]?.children[0]?.props).toMatchObject({ text: 'Hello' })
  })

  it('offers only valid locations and moves the feature', async () => {
    const { doc, w } = await inspect([page(), inst('ContainerFeature', 'c', { columns: 2 }), inst('TextFeature', 't')], 'c')
    const options = w.get('#input-location').findAll('option').map((o) => o.text())
    // Not its own cells: a feature cannot be placed inside itself.
    expect(options).toEqual(['Document', 'Page › content'])
    doc.select('t')
    await w.vm.$nextTick()
    await w.get('#input-location').setValue('c\u0000r1c2')
    expect(doc.model?.features.find((f) => f.id === 't')?.placement).toEqual(at('c', 'r1c2'))
  })

  it('lists matching features for references', async () => {
    const { w } = await inspect([page(), inst('DataResourceFeature', 'r', { name: 'Repos' }, null), inst('TextFeature', 'x'), inst('TableFeature', 't', { data_resource: '' })], 't')
    expect(w.get('#input-data_resource').findAll('option').map((o) => o.text())).toEqual(['None', 'Repos (#r)'])
  })

  it('confirms deletes, listing what goes with the feature', async () => {
    const { doc, w } = await inspect([page(), inst('ContainerFeature', 'c', { columns: 1 }), inst('TextFeature', 't', {}, at('c', 'r1c1'))], 'c')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    await w.get('[data-testid="delete-feature"]').trigger('click')
    expect(confirm).toHaveBeenLastCalledWith('Delete "ContainerFeature c"?\n1 feature(s) inside it will be deleted too.')
    expect(doc.model?.features).toHaveLength(3)
    await w.get('[data-testid="delete-feature"]').trigger('click')
    expect(doc.model?.features.map((f) => f.id)).toEqual(['1'])
  })

  it('explains unported features and still allows deleting them', async () => {
    const { w } = await inspect([page(), inst('MapFeature', 'm')], 'm')
    expect(w.text()).toContain('MapFeature is not ported yet')
    expect(w.find('[data-testid="delete-feature"]').exists()).toBe(true)
  })
})

describe('List and placeholder nodes', () => {
  it('render list items and placeholders', () => {
    const r = generate(model(page(), inst('ListFeature', 'l', { items: ['Red', '<b>Green</b>'], align: 'right' }), inst('MapFeature', 'm')), undefined, { placeholders: true })
    const w = mount(DocumentView, { props: { root: r.root } })
    expect(w.get('[data-feature-id="l"]').classes()).toEqual(['fd-list', 'fd-list-right'])
    expect(w.findAll('[data-feature-id="l"] li').map((li) => li.text())).toEqual(['Red', '<b>Green</b>'])
    const placeholder = w.get('[data-feature-id="m"]')
    expect(placeholder.classes()).toEqual(['fd-placeholder', 'fd-placeholder-unknown'])
    expect(placeholder.text()).toBe('MapFeature mMapFeature is not ported yet')
  })
})
