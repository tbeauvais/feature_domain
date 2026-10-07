import { generate, MemoryModelStore, type InputDef, type InputValue } from '@feature-domain/engine'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref, type Ref } from 'vue'
import { confirmAction, pendingConfirm } from '../src/editor/confirm'
import ConfirmHost from '../src/editor/ConfirmHost.vue'
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
    const short = mount(InputField, { props: { def: def({ type: 'color' }), value: '#ABC' } })
    expect((short.get('input[type="color"]').element as HTMLInputElement).value).toBe('#aabbcc')

    const ref = mount(InputField, { props: { def: def({ type: 'reference' }), value: '', references: [{ id: 'r', label: 'Repos (#r)' }] } })
    expect(ref.findAll('option').map((o) => o.text())).toEqual(['None', 'Repos (#r)'])
    await ref.get('select').setValue('r')
    expect(lastChange(ref)).toBe('r')
  })
})

describe('InputField while typing', () => {
  // Like the editor: every emitted value goes into the model and comes straight back as the field's value.
  function controlled(d: InputDef, initial: InputValue | undefined) {
    const value: Ref<InputValue | undefined> = ref(initial)
    const Host = defineComponent(() => () => h(InputField, { def: d, value: value.value, onChange: (v: InputValue | undefined) => (value.value = v) }))
    return { value, w: mount(Host) }
  }
  async function type(w: VueWrapper, selector: string, keys: string) {
    const el = w.get(selector).element as HTMLInputElement | HTMLTextAreaElement
    for (const key of keys) {
      el.value += key
      await w.get(selector).trigger('input')
    }
  }

  it('keeps a new line and spaces while typing list items, storing trimmed items', async () => {
    const { value, w } = controlled(def({ type: 'list' }), ['Red', 'Green', 'Blue'])
    await type(w, 'textarea', '\nNew York')
    expect((w.get('textarea').element as HTMLTextAreaElement).value).toBe('Red\nGreen\nBlue\nNew York')
    expect(value.value).toEqual(['Red', 'Green', 'Blue', 'New York'])
    await type(w, 'textarea', '\n')
    expect((w.get('textarea').element as HTMLTextAreaElement).value).toBe('Red\nGreen\nBlue\nNew York\n')
  })

  it('lets a number be cleared and retyped without the default coming back', async () => {
    const { value, w } = controlled(def({ type: 'integer', default: 2 }), 2)
    const input = w.get('input')
    await input.setValue('')
    expect((input.element as HTMLInputElement).value).toBe('')
    expect(value.value).toBeUndefined()
    await type(w, 'input', '3')
    expect((input.element as HTMLInputElement).value).toBe('3')
    expect(value.value).toBe(3)
  })

  it('shows the stored value again on blur, and adopts outside changes', async () => {
    const { value, w } = controlled(def({ type: 'integer', default: 2 }), 5)
    await w.get('input').setValue('')
    await w.get('input').trigger('blur')
    expect((w.get('input').element as HTMLInputElement).value).toBe('2')
    value.value = 7
    await w.vm.$nextTick()
    expect((w.get('input').element as HTMLInputElement).value).toBe('7')
  })

  it('shows values that are no longer among the options', () => {
    const ref = mount(InputField, { props: { def: def({ type: 'reference' }), value: 'gone', references: [{ id: 'r', label: 'Repos (#r)' }] } })
    expect(ref.findAll('option').map((o) => [o.text(), o.attributes('disabled') !== undefined])).toEqual([
      ['None', false],
      ['Missing: #gone', true],
      ['Repos (#r)', false],
    ])
    expect((ref.get('select').element as HTMLSelectElement).value).toBe('gone')
    const options = mount(InputField, { props: { def: def({ type: 'string', options: [{ value: 'a', text: 'A' }] }), value: 'text-info' } })
    expect(options.findAll('option').map((o) => o.text())).toEqual(['Unknown: text-info', 'A'])
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

  it('shows a broken placement instead of a blank Location', async () => {
    const { w } = await inspect([page(), inst('TextFeature', 't', {}, at('nowhere', 'x'))], 't')
    const select = w.get('#input-location')
    expect(select.findAll('option')[0]!.text()).toBe('Missing: nowhere › x')
    expect((select.element as HTMLSelectElement).value).toBe('nowhere\u0000x')
  })

  it('offers Themes for a Page, and shows a theme that no longer exists as Missing', async () => {
    const themed = await inspect([inst('ThemeFeature', 'th', { name: 'Warm' }, null), page({ theme: 'th' }), inst('TextFeature', 'x')], '1')
    expect(themed.w.get('#input-theme').findAll('option').map((o) => o.text())).toEqual(['None', 'Warm (#th)'])
    expect((themed.w.get('#input-theme').element as HTMLSelectElement).value).toBe('th')

    const stale = await inspect([page({ theme: 'gone' })], '1')
    const options = stale.w.get('#input-theme').findAll('option')
    expect(options.map((o) => [o.text(), o.attributes('disabled') !== undefined])).toEqual([
      ['None', false],
      ['Missing: #gone', true],
    ])
  })

  it('lists matching features for references', async () => {
    const { w } = await inspect([page(), inst('DataResourceFeature', 'r', { name: 'Repos' }, null), inst('TextFeature', 'x'), inst('TableFeature', 't', { data_resource: '' })], 't')
    expect(w.get('#input-data_resource').findAll('option').map((o) => o.text())).toEqual(['None', 'Repos (#r)'])
  })

  it('confirms deletes in the page, listing what goes with the feature', async () => {
    const { doc, w } = await inspect([page(), inst('ContainerFeature', 'c', { columns: 1 }), inst('TextFeature', 't', {}, at('c', 'r1c1'))], 'c')
    await w.get('[data-testid="delete-feature"]').trigger('click')
    expect(pendingConfirm.value).toMatchObject({
      title: 'Delete "ContainerFeature c"?',
      description: '1 feature(s) inside it will be deleted too.\nYou can undo this.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    pendingConfirm.value!.resolve(false)
    await flushPromises()
    expect(doc.model?.features).toHaveLength(3)
    await w.get('[data-testid="delete-feature"]').trigger('click')
    pendingConfirm.value!.resolve(true)
    await flushPromises()
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

describe('confirmAction and ConfirmHost', () => {
  it('shows an in-page dialog and resolves with the choice', async () => {
    const w = mount(ConfirmHost, { attachTo: document.body })
    try {
      const answer = confirmAction({ title: 'Delete it?', description: 'Line one\nLine two', confirmLabel: 'Delete', destructive: true })
      await flushPromises()
      const dialog = document.querySelector('[data-testid="confirm-dialog"]')!
      expect(dialog.textContent).toContain('Delete it?')
      expect(dialog.textContent).toContain('Line one')
      ;(document.querySelector('[data-testid="confirm-ok"]') as HTMLElement).click()
      expect(await answer).toBe(true)
      expect(pendingConfirm.value).toBeNull()

      const cancelled = confirmAction({ title: 'Again?', description: '', confirmLabel: 'OK' })
      await flushPromises()
      ;(document.querySelector('[data-testid="confirm-cancel"]') as HTMLElement).click()
      expect(await cancelled).toBe(false)
    } finally {
      w.unmount()
    }
  })

  it('treats a new request, or cancelling, as "no" for the earlier one', async () => {
    const first = confirmAction({ title: 'A', description: '', confirmLabel: 'OK' })
    const second = confirmAction({ title: 'B', description: '', confirmLabel: 'OK' })
    expect(await first).toBe(false)
    pendingConfirm.value!.resolve(false)
    expect(await second).toBe(false)
  })
})
