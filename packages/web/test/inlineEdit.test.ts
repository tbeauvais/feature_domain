import { MemoryModelStore, type AppModel } from '@feature-domain/engine'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { inlineEdit, NEW_TEXT, useInlineEdit } from '../src/editor/useInlineEdit'
import DocumentView from '../src/renderer/DocumentView.vue'
import { setModelStore } from '../src/services'
import { useDocumentStore } from '../src/stores/document'
import { at, inst, model, page } from './helpers'

/** The editor canvas: the document in editing mode, with inline editing on it. */
const Canvas = defineComponent({
  setup(_, { expose }) {
    const store = useDocumentStore()
    const canvas = ref<HTMLElement | null>(null)
    expose(useInlineEdit(canvas))
    return () => h('div', { ref: canvas }, store.result ? [h(DocumentView, { root: store.result.root, editing: true })] : [])
  },
})

let w: VueWrapper
let store: ReturnType<typeof useDocumentStore>

async function open(m: AppModel) {
  setActivePinia(createPinia())
  const models = new MemoryModelStore()
  setModelStore(models)
  store = useDocumentStore()
  store.editing = true
  await store.load(await models.create(m))
  w = mount(Canvas, { attachTo: document.body })
  await nextTick()
}

const root = () => w.element as HTMLElement
const el = (selector: string) => root().querySelector<HTMLElement>(selector)!
const editing = () => root().querySelector<HTMLElement>('[data-fd-editing]')
const inputs = (id: string) => store.model!.features.find((f) => f.id === id)!.inputs

/** Types into the element being edited, as the browser would: replacing its nodes. */
function type(text: string) {
  editing()!.replaceChildren(document.createTextNode(text))
}

async function key(key: string, options: KeyboardEventInit = {}) {
  editing()!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }))
  await nextTick()
  await nextTick()
}

async function dblclick(selector: string) {
  el(selector).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  await nextTick()
}

beforeEach(() => {
  inlineEdit.value = null
})
afterEach(() => w?.unmount())

describe('inline text editing', () => {
  const sample = () =>
    model(
      page(),
      inst('HeaderFeature', 'h', { text: 'Hello' }),
      inst('ListFeature', 'l', { items: ['Red', 'Green'] }),
      inst('TextWithParagraphFeature', 'tp', { title: 'Title', text: 'One\n\nTwo' }),
      inst('PanelFeature', 'p', { heading: 'Panel' }),
      inst('HeaderFeature', 'in', { text: 'Inside' }, at('p', 'body')),
      inst('TextFeature', 't', { text: 'Plain words' }),
    )

  it('marks editable text on the canvas, and starts editing it on a double-click', async () => {
    await open(sample())
    expect(el('[data-feature-id="h"]').getAttribute('data-edit')).toBe('text')
    expect([...w.element.querySelectorAll('[data-edit-node="l"]')].map((li) => li.getAttribute('data-edit-item'))).toEqual(['0', '1'])
    await dblclick('[data-feature-id="h"]')
    expect(editing()).toBe(el('[data-feature-id="h"]'))
    expect(editing()!.getAttribute('contenteditable')).toMatch(/^(plaintext-only|true)$/)
    expect(inlineEdit.value).toEqual({ feature: 'h', element: editing() })
    expect(store.selectedId).toBe('h')
    // Dragging is off while editing, so the mouse selects text.
    expect(editing()!.getAttribute('draggable')).not.toBe('true')
  })

  it('commits on Enter as one undo step, and the page shows the new text', async () => {
    await open(sample())
    await dblclick('[data-feature-id="h"]')
    type('Hi there')
    await key('Enter')
    expect(editing()).toBeNull()
    expect(inputs('h').text).toBe('Hi there')
    expect(el('[data-feature-id="h"]').textContent).toBe('Hi there')
    expect(el('[data-feature-id="h"]').hasAttribute('contenteditable')).toBe(false)
    store.undo()
    await nextTick()
    expect(inputs('h').text).toBe('Hello')
    expect(el('[data-feature-id="h"]').textContent).toBe('Hello')
    expect(store.canUndo).toBe(false)
  })

  it('commits when the text is left', async () => {
    await open(sample())
    await dblclick('[data-node-id="p"] [data-edit="heading"]')
    type('Details')
    editing()!.dispatchEvent(new FocusEvent('blur'))
    await nextTick()
    expect(inputs('p').heading).toBe('Details')
    expect(el('[data-node-id="p"] [data-edit="heading"]').textContent).toBe('Details')
  })

  it('puts the text back on Escape, changing nothing', async () => {
    await open(sample())
    const before = store.model
    await dblclick('[data-feature-id="h"]')
    type('Nope')
    await key('Escape')
    expect(editing()).toBeNull()
    expect(store.model).toBe(before)
    expect(el('[data-feature-id="h"]').textContent).toBe('Hello')
    expect(el('[data-feature-id="h"]').getAttribute('draggable')).not.toBe('false')
  })

  it('makes no undo step when nothing changed', async () => {
    await open(sample())
    await dblclick('[data-feature-id="h"]')
    await key('Enter')
    expect(store.canUndo).toBe(false)
  })

  it('adds the next list item on Enter and edits it; Escape takes it back out in the same undo step', async () => {
    await open(sample())
    await dblclick('[data-edit-node="l"][data-edit-item="0"]')
    type('Crimson')
    await key('Enter')
    expect(inputs('l').items).toEqual(['Crimson', NEW_TEXT.item, 'Green'])
    expect(editing()).toBe(el('[data-edit-node="l"][data-edit-item="1"]'))
    expect(window.getSelection()?.toString()).toBe(NEW_TEXT.item)

    await key('Escape')
    expect(inputs('l').items).toEqual(['Crimson', 'Green'])
    expect(store.canRedo).toBe(false)
    store.undo()
    expect(inputs('l').items).toEqual(['Red', 'Green'])
    expect(store.canUndo).toBe(false)
  })

  it('keeps an added item that was typed into, and Shift+Enter commits without adding', async () => {
    await open(sample())
    await dblclick('[data-edit-node="l"][data-edit-item="1"]')
    await key('Enter')
    type('Blue')
    await key('Enter', { shiftKey: true })
    expect(inputs('l').items).toEqual(['Red', 'Green', 'Blue'])
    expect(editing()).toBeNull()
  })

  it('removes an item emptied on the page, without adding one', async () => {
    await open(sample())
    await dblclick('[data-edit-node="l"][data-edit-item="0"]')
    type('')
    await key('Enter')
    expect(inputs('l').items).toEqual(['Green'])
    expect(editing()).toBeNull()
  })

  it('adds after an item that was empty and still is, rather than removing it', async () => {
    await open(model(page(), inst('ListFeature', 'l', { items: ['Red', '', 'Blue'] })))
    await dblclick('[data-edit-node="l"][data-edit-item="1"]')
    await key('Enter')
    expect(inputs('l').items).toEqual(['Red', '', NEW_TEXT.item, 'Blue'])
    expect(editing()).toBe(el('[data-edit-node="l"][data-edit-item="2"]'))
  })

  it('edits a Text, whose element holds its text in several nodes', async () => {
    await open(sample())
    await dblclick('[data-feature-id="t"]')
    type('New words')
    await key('Enter')
    expect(inputs('t').text).toBe('New words')
    expect(el('[data-feature-id="t"]').textContent).toBe('New words')
    store.undo()
    await nextTick()
    expect(el('[data-feature-id="t"]').textContent).toBe('Plain words')
  })

  it('ignores the Enter that confirms an input method’s candidate', async () => {
    await open(sample())
    await dblclick('[data-feature-id="h"]')
    type('こんにちは')
    await key('Enter', { isComposing: true })
    await key('Enter', { keyCode: 229 } as KeyboardEventInit)
    // Safari ends the composition just before that Enter.
    editing()!.dispatchEvent(new CompositionEvent('compositionend'))
    await key('Enter')
    expect(editing()).not.toBeNull()
    expect(inputs('h').text).toBe('Hello')
  })

  it('starts a paragraph on Enter in a text of paragraphs', async () => {
    await open(sample())
    await dblclick('[data-node-id="tp.p1"]')
    await key('Enter')
    expect(inputs('tp').text).toBe(`One\n\n${NEW_TEXT.paragraph}\n\nTwo`)
    expect(editing()).toBe(el('[data-node-id="tp.p2"]'))
    type('Between')
    await key('Enter', { shiftKey: true })
    expect(inputs('tp').text).toBe('One\n\nBetween\n\nTwo')
    expect(w.findAll('[data-feature-id="tp"] p').map((p) => p.text())).toEqual(['One', 'Between', 'Two'])
  })

  it('edits the selected feature’s first text on request, not text of features inside it', async () => {
    await open(sample())
    store.select('p')
    await nextTick()
    expect((w.vm as unknown as { editSelected: () => boolean }).editSelected()).toBe(true)
    expect(editing()).toBe(el('[data-node-id="p"] [data-edit="heading"]'))
    await key('Escape')
    store.select('tp')
    expect((w.vm as unknown as { editSelected: () => boolean }).editSelected()).toBe(true)
    expect(editing()).toBe(el('[data-node-id="tp.title"]'))
  })

  it('ends the edit, writing nothing, when the text goes away meanwhile', async () => {
    await open(sample())
    await dblclick('[data-feature-id="h"]')
    type('Lost')
    store.remove('h')
    await nextTick()
    await nextTick()
    expect(inlineEdit.value).toBeNull()
    expect(store.model!.features.some((f) => f.id === 'h')).toBe(false)
  })

  it('ends the edit, writing nothing, when the document changes meanwhile, and shows the change', async () => {
    await open(sample())
    await dblclick('[data-feature-id="h"]')
    type('Typed')
    store.setInputs('h', { text: 'From elsewhere' })
    await nextTick()
    await nextTick()
    expect(inlineEdit.value).toBeNull()
    expect(el('[data-feature-id="h"]').textContent).toBe('From elsewhere')
    expect(el('[data-feature-id="h"]').hasAttribute('contenteditable')).toBe(false)
  })

  it('starts after a change that finishing another edit makes, so it edits what is rendered', async () => {
    await open(model(page(), inst('ListFeature', 'l', { items: ['Red', 'Green', 'Blue'] })))
    await dblclick('[data-edit-node="l"][data-edit-item="0"]')
    type('')
    // Finishing the first edit removes Red, so the second item now shows Blue.
    const second = el('[data-edit-node="l"][data-edit-item="1"]')
    expect((w.vm as unknown as { begin: (el: HTMLElement) => boolean }).begin(second)).toBe(true)
    expect(inputs('l').items).toEqual(['Green', 'Blue'])
    await nextTick()
    await nextTick()
    expect(editing()).toBe(second)
    expect(window.getSelection()?.toString()).toBe('Blue')
    await key('Escape')
    expect(root().querySelectorAll('li')[1]!.textContent).toBe('Blue')
  })

  it('pastes plain text only', async () => {
    await open(sample())
    await dblclick('[data-feature-id="h"]')
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(paste, 'clipboardData', { value: { getData: (t: string) => (t === 'text/plain' ? 'Plain <b>text</b>' : '<b>bold</b>') } })
    editing()!.dispatchEvent(paste)
    expect(paste.defaultPrevented).toBe(true)
    expect(editing()!.querySelector('b')).toBeNull()
    await key('Enter')
    expect(inputs('h').text).toBe('Plain <b>text</b>')
  })
})

describe('the preview', () => {
  it('has no editable text', () => {
    const doc = mount(DocumentView, {
      props: {
        root: {
          id: '$root',
          kind: 'root',
          props: {},
          children: [
            { id: 'h', kind: 'heading', props: { text: 'Hi', level: 1, align: 'left' }, edit: { text: { input: 'text', kind: 'text' } }, children: [] },
          ],
        },
      },
    })
    expect(doc.find('[data-edit]').exists()).toBe(false)
    doc.unmount()
  })
})
