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

/** How soon after an input method's composition ends an Enter still belongs to it (Safari). */
const COMPOSITION_GRACE_MS = 50
const eventTime = () => performance.now()

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
  /** The document the element was rendered from: any regeneration ends the edit (see the watch below). */
  result: unknown
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

  /**
   * Starts editing an element's text. Keeps a selection already inside it (a double-clicked word), else selects all.
   * Finishing another edit, or leaving a field that saves on blur, may change the model; then the page re-renders
   * first and editing starts after, so what the element shows is what was rendered.
   */
  function begin(element: HTMLElement, added?: Session['added']): boolean {
    if (session?.element === element) return true
    const before = store.result
    finish()
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== element) active.blur()
    if (store.result !== before) {
      void nextTick(() => element.isConnected && begin(element, added))
      return true
    }
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
    const plaintextOnly = element.contentEditable === 'plaintext-only'
    if (!plaintextOnly) element.setAttribute('contenteditable', 'true')
    element.setAttribute('data-fd-editing', '')
    element.setAttribute('spellcheck', 'true')

    // Enter confirming an input method's candidate (Japanese, Chinese, …) isn't a commit. Safari ends the composition
    // before that keydown, so it is recognized by its key code or by following the composition's end at once.
    let composedAt = -Infinity
    const onCompositionEnd = () => (composedAt = eventTime())
    const onKeydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || eventTime() - composedAt < COMPOSITION_GRACE_MS) return
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
    // Only without plaintext-only: with it, the browser pastes plain text itself (and keeps the paste undoable).
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
    element.addEventListener('compositionend', onCompositionEnd)
    element.addEventListener('blur', onBlur)
    if (!plaintextOnly) element.addEventListener('paste', onPaste)
    element.addEventListener('drop', onDrop)
    const stop = () => {
      element.removeEventListener('keydown', onKeydown)
      element.removeEventListener('compositionend', onCompositionEnd)
      element.removeEventListener('blur', onBlur)
      element.removeEventListener('paste', onPaste)
      element.removeEventListener('drop', onDrop)
    }

    session = { element, location, original: element.textContent ?? '', children, values: children.map((c) => c.nodeValue), undraggable, added, result: store.result, stop }
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
      // EditError: the text was removed meanwhile, so there is nothing to write it into. Anything else is a bug, logged
      // rather than thrown out of a blur handler.
      if (!(error instanceof EditError)) console.error('Inline text edit failed', error)
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

  // Any other change to the document (e.g. another tab's) ends the edit without writing anything. This runs before the
  // page re-renders, so the element is put back as rendered and then updated as usual. (A commit ends the edit first.)
  watch(
    () => store.result,
    (result) => {
      if (session && session.result !== result) end()
    },
    { flush: 'pre' },
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
