import { EditError, findEditable, markLocation, walkNodes, type DocNode, type TextLocation } from '@feature-domain/engine'
import { nextTick, onBeforeUnmount, onMounted, shallowRef, watch, type Ref } from 'vue'
import { useDocumentStore } from '../stores/document'

/** The text being edited on the canvas: its feature, and the element made editable. */
export interface InlineEditState {
  feature: string
  element: HTMLElement
}

/** The inline edit in progress, shared with drag and drop (which is off for that feature) and the selection outline. */
export const inlineEdit = shallowRef<InlineEditState | null>(null)

/** What a new list entry or paragraph says when Enter adds one; it is selected, so typing replaces it. */
export const NEW_TEXT = { item: 'New item', paragraph: 'New paragraph' } as const

interface Session {
  element: HTMLElement
  location: TextLocation
  original: string
  /** The element's children and their text as rendered, put back before the store's change re-renders it. */
  children: Node[]
  values: (string | null)[]
  /** Draggable elements around it, made undraggable while editing so the mouse selects text. */
  undraggable: HTMLElement[]
  /** For an entry Enter just added: the edit before it and the model it made, so Escape can take the entry back out. */
  added?: { previous: TextLocation; text: string; model: unknown }
  stop: () => void
}

/** The node with this id in a generated document. */
function nodeById(root: DocNode, id: string): DocNode | undefined {
  let found: DocNode | undefined
  walkNodes(root, (n) => {
    if (n.id === id) found ??= n
  })
  return found
}

/** The element showing the text at `location`, if the canvas shows it. */
function elementFor(canvas: HTMLElement, root: DocNode, location: TextLocation): HTMLElement | null {
  const found = findEditable(root, location)
  if (!found) return null
  let selector = `[data-edit-node="${CSS.escape(found.node.id)}"][data-edit="${CSS.escape(found.prop)}"]`
  if (found.item !== undefined) selector += `[data-edit-item="${found.item}"]`
  return canvas.querySelector<HTMLElement>(selector)
}

function selectAll(element: HTMLElement): void {
  const range = document.createRange()
  range.selectNodeContents(element)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

/**
 * Inline text editing on the canvas. Text the engine marks as a copy of an input (`DocNode.edit`, rendered as
 * `data-edit` attributes) becomes plain-text editable on a double-click, or with Enter on a selected feature. Enter or
 * leaving the text commits it through the store as one undo step; in a list or a text of paragraphs, Enter also adds
 * the next entry or paragraph and edits it. Escape cancels.
 *
 * The browser edits the rendered DOM directly, so before the change goes to the store the element's own nodes are put
 * back as rendered; Vue then re-renders it from the regenerated document as usual.
 */
export function useInlineEdit(canvas: Ref<HTMLElement | null>) {
  const store = useDocumentStore()
  let session: Session | null = null

  /** Where an element's text comes from in the model, from its `data-edit` attributes and the generated document. */
  function locationOf(element: HTMLElement): TextLocation | undefined {
    const nodeId = element.getAttribute('data-edit-node')
    const prop = element.getAttribute('data-edit')
    const feature = element.closest('[data-feature-id]')?.getAttribute('data-feature-id')
    const root = store.result?.root
    if (nodeId === null || prop === null || !feature || !root) return undefined
    const mark = nodeById(root, nodeId)?.edit?.[prop]
    const item = element.getAttribute('data-edit-item')
    return mark && markLocation(feature, mark, item === null ? undefined : Number(item))
  }

  /** Starts editing an element's text. Keeps a selection already inside it (a double-clicked word), else selects all. */
  function begin(element: HTMLElement, added?: Session['added']): boolean {
    if (session?.element === element) return true
    finish()
    const location = locationOf(element)
    if (!location) return false
    store.select(location.feature)
    const kept = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null
    const keep = kept && element.contains(kept.commonAncestorContainer) && !kept.collapsed ? kept.cloneRange() : null

    const children = [...element.childNodes]
    const undraggable: HTMLElement[] = []
    for (let el: HTMLElement | null = element; el && el !== canvas.value; el = el.parentElement) {
      if (el.getAttribute('draggable') === 'true') {
        el.setAttribute('draggable', 'false')
        undraggable.push(el)
      }
    }
    // Plain text only, so pasted HTML can't get in (browsers without plaintext-only get the paste handler below).
    element.setAttribute('contenteditable', 'plaintext-only')
    if (element.contentEditable !== 'plaintext-only') element.setAttribute('contenteditable', 'true')
    element.setAttribute('data-fd-editing', '')
    element.setAttribute('spellcheck', 'true')

    const onKeydown = (event: KeyboardEvent) => {
      if (event.isComposing) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        cancel()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        commit(!event.shiftKey)
      }
    }
    const onBlur = () => commit(false)
    const onPaste = (event: ClipboardEvent) => {
      event.preventDefault()
      const text = event.clipboardData?.getData('text/plain') ?? ''
      const selection = window.getSelection()
      if (!text || !selection?.rangeCount) return
      const range = selection.getRangeAt(0)
      range.deleteContents()
      const inserted = document.createTextNode(text)
      range.insertNode(inserted)
      range.setStartAfter(inserted)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    }
    // Dropped text or files would land in the page as they are; the feature's text only changes by typing.
    const onDrop = (event: DragEvent) => event.preventDefault()
    element.addEventListener('keydown', onKeydown)
    element.addEventListener('blur', onBlur)
    element.addEventListener('paste', onPaste)
    element.addEventListener('drop', onDrop)
    const stop = () => {
      element.removeEventListener('keydown', onKeydown)
      element.removeEventListener('blur', onBlur)
      element.removeEventListener('paste', onPaste)
      element.removeEventListener('drop', onDrop)
    }

    session = { element, location, original: element.textContent ?? '', children, values: children.map((c) => c.nodeValue), undraggable, added, stop }
    inlineEdit.value = { feature: location.feature, element }
    element.focus()
    const selection = window.getSelection()
    if (keep) {
      selection?.removeAllRanges()
      selection?.addRange(keep)
    } else selectAll(element)
    return true
  }

  /** Ends editing and puts the element back as rendered. Returns what had been typed. */
  function end(): { location: TextLocation; text: string; original: string; added?: Session['added'] } | undefined {
    const s = session
    if (!s) return undefined
    session = null
    s.stop()
    const text = s.element.textContent ?? ''
    s.element.replaceChildren(...s.children)
    s.children.forEach((child, i) => {
      if (child.nodeValue !== s.values[i]) child.nodeValue = s.values[i]!
    })
    s.element.removeAttribute('contenteditable')
    s.element.removeAttribute('data-fd-editing')
    s.element.removeAttribute('spellcheck')
    for (const el of s.undraggable) el.setAttribute('draggable', 'true')
    inlineEdit.value = null
    return { location: s.location, text, original: s.original, added: s.added }
  }

  /** Commits the typed text; with `add`, in a list or paragraphs, adds the next entry or paragraph and edits it. */
  function commit(add: boolean): void {
    const ended = end()
    if (!ended) return
    const { location, text, original } = ended
    const adding = add && location.kind !== 'text'
    if (text === original && !adding) return
    try {
      const added = store.editText(location, text, adding ? NEW_TEXT[location.kind as 'item' | 'paragraph'] : undefined)
      if (added) void nextTick(() => beginAt(added, { previous: location, text, model: store.model }))
    } catch (error) {
      // The text was removed meanwhile (e.g. by another tab): nothing to write it into.
      if (!(error instanceof EditError)) throw error
    }
  }

  /**
   * Puts the text back as it was. An entry Enter just added goes again, if nothing changed since: the step that added
   * it is taken back and the edit before it made again, so it is one undo step as if Enter had never added anything.
   */
  function cancel(): void {
    const added = end()?.added
    if (!added || store.model !== added.model) return
    store.retract()
    store.editText(added.previous, added.text)
  }

  /** Commits an edit in progress (e.g. before something else is edited). */
  function finish(): void {
    if (session) commit(false)
  }

  /** Starts editing the text at a location, once the canvas shows it. */
  function beginAt(location: TextLocation, added?: Session['added']): boolean {
    const root = store.result?.root
    const element = canvas.value && root ? elementFor(canvas.value, root, location) : null
    return element ? begin(element, added) : false
  }

  /** Edits the first text of the selected feature that can be edited in place (Enter on a selected feature). */
  function editSelected(): boolean {
    const id = store.selectedId
    const featureEl = id !== null ? canvas.value?.querySelector(`[data-feature-id="${CSS.escape(id)}"]`) : null
    if (!featureEl) return false
    const own = [...featureEl.querySelectorAll<HTMLElement>('[data-edit]')]
    if (featureEl instanceof HTMLElement && featureEl.hasAttribute('data-edit')) own.unshift(featureEl)
    const element = own.find((el) => el.closest('[data-feature-id]') === featureEl)
    return element ? begin(element) : false
  }

  function onDblclick(event: MouseEvent) {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-edit]') : null
    if (target && canvas.value?.contains(target)) begin(target)
  }

  // A regeneration that removed the element (another tab's change) ends the edit without writing anything.
  watch(
    () => store.result,
    () => {
      if (session && !session.element.isConnected) end()
    },
    { flush: 'post' },
  )

  onMounted(() => {
    watch(
      canvas,
      (el, old) => {
        old?.removeEventListener('dblclick', onDblclick)
        el?.addEventListener('dblclick', onDblclick)
      },
      { immediate: true },
    )
  })
  onBeforeUnmount(() => {
    finish()
    canvas.value?.removeEventListener('dblclick', onDblclick)
  })

  return { begin, beginAt, editSelected, finish, cancel, isEditing: () => session !== null }
}
