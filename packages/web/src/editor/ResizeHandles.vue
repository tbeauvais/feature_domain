<script setup lang="ts">
import { defaultRegistry, resolveInputs, type FeatureInstance, type InputValue } from '@feature-domain/engine'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useDocumentStore } from '../stores/document'
import { dragState } from './dndState'
import { DRAG_THRESHOLD } from './resize'
import { referenceDimensions, resizeHandles, type DimensionLine, type ReferenceDimension, type ResizeHandle, type Tick } from './resizeHandles'
import { resizeHintShown } from './resizeState'
import { useRemeasure } from './useRemeasure'

// A feature's sizes, drawn as dimensions (as in CAD): a line beside the feature with its value on a pill. Dragging the
// pill (or the feature's edge, which has a strip of its own) changes the size, the arrow keys on a focused pill step
// it, and a double-click (or Enter) types it. Sizes no input sets are drawn grey and dashed, saying why. Each change
// only edits inputs, and the page regenerates from them. Like the selection outline, the dimensions live outside the
// generated page (.fd-root), positioned from bounding boxes. The selected feature's are shown, or with `all` every
// feature's (another feature's pill selects it). Off while text is edited in place (`disabled`) and while a feature is
// dragged (so a drop never lands on one).
const props = defineProps<{ container: HTMLElement | null; selectedId: string | null; version: unknown; disabled?: boolean; all?: boolean }>()

const store = useDocumentStore()

/** How thick an edge's strip is, and the shortest it is drawn (a separator's rule is a pixel high). */
const STRIP = 12
const MIN_LENGTH = 40
/** Within this distance of the canvas's scrolling edge, a drag scrolls it (pixels per frame at the very edge). */
const SCROLL_ZONE = 40
const SCROLL_SPEED = 16
/** Dimensions stay this far inside the canvas, so one beside a full-width feature isn't drawn off it. */
const INSET = 10
/**
 * About how wide a pill showing `text` is (12 px semibold, with its padding): a vertical dimension goes on the feature's
 * left when it doesn't fit on its right.
 */
const pillWidth = (text: string) => text.length * 6 + 24

/** A line in the container's coordinates: from (x1, y1) to (x2, y2). */
interface Segment {
  x1: number
  y1: number
  x2: number
  y2: number
}

/**
 * A dimension as drawn: its line, the extension lines from the feature to it, and where its pill sits. A vertical
 * dimension's pill sits beside its line (`side`), clear of the feature's edge and its grip.
 */
interface Drawn {
  axis: 'x' | 'y'
  line: Segment
  extensions: Segment[]
  pill: { x: number; y: number }
  side?: 'right' | 'left'
}

interface Placed {
  /** `<feature id>:<handle key>`, unique on the canvas. */
  id: string
  feature: string
  selected: boolean
  handle: ResizeHandle
  drawn: Drawn
  /** The edge's strip, relative to the container (the selected feature's only). */
  strip?: { top: number; left: number; width: number; height: number }
}

interface PlacedReference {
  id: string
  selected: boolean
  reference: ReferenceDimension
  drawn: Drawn
}

const placed = shallowRef<Placed[]>([])
const references = shallowRef<PlacedReference[]>([])
/** The drag in progress, from press to release. `moved`: past the threshold; `cancelled`: Escape put the value back. */
let drag: {
  id: string
  /** The feature the size belongs to (selected by the press), and the one whose inputs change (its theme, for a page). */
  owner: string
  feature: string
  gesture: string
  pointer: number
  element: HTMLElement
  start: { x: number; y: number }
  /** From the pointer to the edge it moves, so pressing anywhere on the pill or strip doesn't jump the edge. */
  offset: { x: number; y: number }
  last: { x: number; y: number; fine: boolean }
  moved: boolean
  cancelled: boolean
  changed: boolean
} | null = null
let gestures = 0
let frame = 0
const active = ref<string | null>(null)
const focused = ref<string | null>(null)
const hovered = ref<string | null>(null)
const ticks = shallowRef<{ axis: 'x' | 'y'; lines: { top: number; left: number; length: number; label?: string }[] } | null>(null)
const announcement = ref('')
/** The value being typed: which dimension, the text, and whether it was refused. */
const editing = ref<{ id: string; text: string; invalid: boolean } | null>(null)
const editor = ref<HTMLInputElement[]>([])

const { observe } = useRemeasure(() => props.container, measure)

const instance = (id: string | null): FeatureInstance | undefined => (id === null ? undefined : store.model?.features.find((f) => f.id === id))

function described(feature: FeatureInstance) {
  const def = defaultRegistry.get(feature.feature)
  if (!def) return undefined
  const name = typeof feature.inputs.name === 'string' && feature.inputs.name.trim() !== '' ? feature.inputs.name.trim() : def.name
  return { feature: feature.feature, inputs: resolveInputs(def.inputs, feature.inputs), name }
}

/** Client coordinates to the container's padding box (where absolutely positioned overlays sit). */
function toContainer(container: HTMLElement) {
  const outer = container.getBoundingClientRect()
  return {
    x: (clientX: number) => clientX - outer.left - container.clientLeft + container.scrollLeft,
    y: (clientY: number) => clientY - outer.top - container.clientTop + container.scrollTop,
  }
}

/** A dimension in the container's coordinates, kept inside it; `across` is the feature's extent the extension lines start from. */
function draw(container: HTMLElement, axis: 'x' | 'y', d: DimensionLine, across: { from: number; to: number }, text: string): Drawn {
  const room = pillWidth(text)
  const at = toContainer(container)
  if (axis === 'y') {
    const [y1, y2] = [at.y(d.from), at.y(d.to)]
    // Beside the feature's right edge if the pill fits there, else beside its left, else just inside its right edge.
    const gap = at.x(d.at) - at.x(across.to)
    const right = at.x(across.to) + gap
    const left = at.x(across.from) - gap
    const side: 'right' | 'left' = right + room <= container.clientWidth || left - room < 0 ? 'right' : 'left'
    const inside = side === 'right' && right + room > container.clientWidth
    const x = inside ? at.x(across.to) - gap : side === 'right' ? right : left
    const start = side === 'right' ? at.x(across.to) : at.x(across.from)
    const out = inside ? -1 : side === 'right' ? 1 : -1
    const drawnSide = inside ? 'left' : side
    return {
      axis,
      line: { x1: x, y1, x2: x, y2 },
      extensions: Math.abs(start - x) > 2 ? [y1, y2].map((y) => ({ x1: start + out * 2, y1: y, x2: x + out * 5, y2: y })) : [],
      pill: { x, y: at.y(d.pill) },
      side: drawnSide,
    }
  }
  const y = Math.max(at.y(d.at), INSET)
  const [x1, x2] = [at.x(d.from), at.x(d.to)]
  // The line is above or below the feature; extension lines run from the feature's nearer edge to it.
  const edge = Math.abs(at.y(across.from) - y) < Math.abs(at.y(across.to) - y) ? at.y(across.from) : at.y(across.to)
  return {
    axis,
    line: { x1, y1: y, x2, y2: y },
    extensions: Math.abs(edge - y) > 2 ? [x1, x2].map((x) => ({ x1: x, y1: edge + Math.sign(y - edge) * 2, x2: x, y2: y + Math.sign(y - edge) * 5 })) : [],
    pill: { x: at.x(d.pill), y },
  }
}

/** The features whose dimensions show: the selected one, or every placed one with `all`. */
function shownFeatures(): string[] {
  if (!props.all) return props.selectedId === null ? [] : [props.selectedId]
  // In model order, whatever is selected: reordering would move a pill in the DOM, which loses a drag's pointer (the
  // selected feature's dimensions are raised with z-index instead).
  return (store.model?.features ?? []).filter((f) => f.placement).map((f) => f.id)
}

function measure() {
  const container = props.container
  const off = props.disabled || dragState.value !== null
  const selected = off ? undefined : instance(props.selectedId)
  observe(selected && container ? container.querySelector(`[data-feature-id="${CSS.escape(selected.id)}"]`) : null)
  if (!container || off) {
    placed.value = []
    references.value = []
    ticks.value = null
    focused.value = hovered.value = null
    editing.value = null
    return
  }
  const lookup = (id: string) => {
    const feature = instance(id)
    return feature ? described(feature) : undefined
  }
  const at = toContainer(container)
  const handles: Placed[] = []
  const refs: PlacedReference[] = []
  for (const id of shownFeatures()) {
    const feature = instance(id)
    const info = feature ? described(feature) : undefined
    if (!info) continue
    const isSelected = id === props.selectedId
    for (const handle of resizeHandles(container, info.feature, id, info.inputs, info.name, lookup)) {
      const length = Math.max(handle.edge.length, MIN_LENGTH)
      const x = at.x(handle.edge.x)
      const y = at.y(handle.edge.y)
      handles.push({
        id: `${id}:${handle.key}`,
        feature: id,
        selected: isSelected,
        handle,
        drawn: draw(container, handle.axis, handle.dimension, handle.across, handle.label ? `${handle.label} = ${handle.text}` : handle.text),
        strip: !isSelected
          ? undefined
          : handle.axis === 'y'
            ? { top: y - STRIP / 2, left: x - length / 2, width: length, height: STRIP }
            : { top: y - length / 2, left: x - STRIP / 2, width: STRIP, height: length },
      })
    }
    for (const reference of referenceDimensions(container, info.feature, id, info.inputs)) {
      const el = container.querySelector(`[data-feature-id="${CSS.escape(id)}"]`)!.getBoundingClientRect()
      const across = reference.axis === 'y' ? { from: el.left, to: el.right } : { from: el.top, to: el.bottom }
      refs.push({
        id: `${id}:${reference.key}`,
        selected: isSelected,
        reference,
        drawn: draw(container, reference.axis, reference.dimension, across, `(${reference.text})`),
      })
    }
  }
  placed.value = handles
  references.value = refs
  // A dimension that went away (another feature selected) takes its hover, focus and typing with it.
  const ids = new Set(handles.map((p) => p.id))
  if (focused.value !== null && !ids.has(focused.value)) focused.value = null
  if (hovered.value !== null && !ids.has(hovered.value)) hovered.value = null
  if (editing.value !== null && !ids.has(editing.value.id)) editing.value = null
  ticks.value = drag?.moved && !drag.cancelled ? measureTicks(container) : null
}

const find = (id: string | undefined) => placed.value.find((p) => p.id === id)

/** The snap marks of the size being dragged, as lines across the feature. */
function measureTicks(container: HTMLElement) {
  const handle = find(drag?.id)?.handle
  if (!handle) return null
  const at = toContainer(container)
  const across =
    handle.axis === 'y' ? { from: at.x(handle.across.from), to: at.x(handle.across.to) } : { from: at.y(handle.across.from), to: at.y(handle.across.to) }
  const line = (tick: Tick) =>
    handle.axis === 'y'
      ? { top: at.y(tick.at), left: across.from, length: across.to - across.from, label: tick.label }
      : { top: across.from, left: at.x(tick.at), length: across.to - across.from, label: tick.label }
  return { axis: handle.axis, lines: handle.ticks().map(line) }
}

watch(
  () => [props.container, props.selectedId, props.version, props.disabled, props.all, dragState.value === null],
  () => void nextTick(measure),
  { immediate: true },
)

/** Applies a size's changes to its feature, unless they change nothing (a drag within one step, a key at the end). */
function change(feature: string, changes: Record<string, InputValue>, gesture?: string): boolean {
  const current = instance(feature)
  const info = current ? described(current) : undefined
  if (!current || !info) return false
  if (Object.entries(changes).every(([name, value]) => info.inputs[name] === value)) return false
  store.setInputs(feature, changes, gesture)
  return true
}

const target = (p: Placed) => p.handle.feature ?? p.feature

function onPointerDown(event: PointerEvent, p: Placed) {
  // One drag at a time, with the primary button (a second finger or button is ignored).
  if (event.button !== 0 || drag || editing.value) return
  // Not a text selection, a feature drag or a click that selects something else.
  event.preventDefault()
  event.stopPropagation()
  const element = event.currentTarget as HTMLElement
  element.setPointerCapture(event.pointerId)
  // Another feature's dimension (with all of them shown) selects it.
  if (p.feature !== props.selectedId) store.select(p.feature)
  // The press focuses the pill, so the arrow keys carry on from it (preventDefault above stops the browser's focus).
  const pill = element.matches('[role="slider"]') ? element : props.container?.querySelector<HTMLElement>(`[data-dimension="${CSS.escape(p.id)}"]`)
  pill?.focus({ preventScroll: true })
  const point = { x: event.clientX, y: event.clientY }
  drag = {
    id: p.id,
    owner: p.feature,
    feature: target(p),
    gesture: `resize-${++gestures}`,
    pointer: event.pointerId,
    element,
    start: point,
    offset: { x: p.handle.edge.x - point.x, y: p.handle.edge.y - point.y },
    last: { ...point, fine: event.shiftKey },
    moved: false,
    cancelled: false,
    changed: false,
  }
  active.value = p.id
  window.addEventListener('keydown', onDragKey, true)
}

function onPointerMove(event: PointerEvent) {
  if (!drag || drag.cancelled || event.pointerId !== drag.pointer) return
  drag.last = { x: event.clientX, y: event.clientY, fine: event.shiftKey }
  // A press that hardly moves is a click, which changes nothing.
  if (!drag.moved && Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) < DRAG_THRESHOLD) return
  drag.moved = true
  if (!frame) frame = requestAnimationFrame(step)
}

/** The scrolling element around the canvas, if any. */
function scroller(): HTMLElement | null {
  let el = props.container?.parentElement ?? null
  while (el) {
    const style = getComputedStyle(el)
    if (/(auto|scroll)/.test(`${style.overflowY} ${style.overflowX}`)) return el
    el = el.parentElement
  }
  return null
}

/** How far to scroll toward an edge the pointer is near: faster the nearer it is, 0 when it isn't near one. */
function push(at: number, from: number, to: number): number {
  if (at < from + SCROLL_ZONE) return -Math.ceil(Math.min(1, (from + SCROLL_ZONE - at) / SCROLL_ZONE) * SCROLL_SPEED)
  if (at > to - SCROLL_ZONE) return Math.ceil(Math.min(1, (at - to + SCROLL_ZONE) / SCROLL_ZONE) * SCROLL_SPEED)
  return 0
}

/**
 * One regeneration per frame: applies the latest pointer position, and near the edge of the scrolling canvas scrolls it
 * (and keeps going while the pointer stays there), so a size below the fold can be dragged further.
 */
function step() {
  frame = 0
  if (!drag || drag.cancelled) return
  const handle = find(drag.id)?.handle
  const area = scroller()
  let scrolled = false
  if (area && handle) {
    const r = area.getBoundingClientRect()
    const vertical = handle.axis === 'y'
    const by = vertical ? push(drag.last.y, r.top, r.bottom) : push(drag.last.x, r.left, r.right)
    if (by !== 0) {
      const before = vertical ? area.scrollTop : area.scrollLeft
      if (vertical) area.scrollTop += by
      else area.scrollLeft += by
      scrolled = (vertical ? area.scrollTop : area.scrollLeft) !== before
    }
  }
  if (handle && change(drag.feature, handle.at(drag.last.x + drag.offset.x, drag.last.y + drag.offset.y, drag.last.fine), drag.gesture)) drag.changed = true
  if (scrolled) frame = requestAnimationFrame(step)
  else if (props.container) ticks.value = measureTicks(props.container)
}

function endDrag() {
  if (!drag) return
  if (frame) {
    cancelAnimationFrame(frame)
    frame = 0
    // The last position still counts.
    if (drag.moved && !drag.cancelled) step()
    if (frame) cancelAnimationFrame(frame)
    frame = 0
  }
  if (drag.element.hasPointerCapture(drag.pointer)) drag.element.releasePointerCapture(drag.pointer)
  window.removeEventListener('keydown', onDragKey, true)
  const { id, changed, cancelled } = drag
  drag = null
  active.value = null
  ticks.value = null
  if (changed && !cancelled) announce(id)
}

/** Says the value a change left, once the page has regenerated (a slider's value text is read only while it is focused). */
function announce(id: string) {
  void nextTick(() => {
    measure()
    const handle = find(id)?.handle
    if (handle) announcement.value = `${handle.name}: ${handle.text}`
  })
}

/**
 * Escape during a drag puts the value back (and nothing is left to undo). The pill keeps the pointer until the button
 * comes up, so that release still lands on it rather than clicking (and deselecting) whatever is under the pointer.
 */
function onDragKey(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !drag || drag.cancelled) return
  event.preventDefault()
  event.stopPropagation()
  store.cancelGesture(drag.gesture)
  drag.cancelled = true
  active.value = null
  ticks.value = null
}

/** Arrow keys step a size; Page Up / Down take five steps, Home / End go to the ends. */
const KEYS: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 5, PageDown: -5, End: 1000, Home: -1000 }

function onKeydown(event: KeyboardEvent, p: Placed) {
  // Enter types the value (rather than editing the feature's text in place).
  if (event.key === 'Enter') {
    event.preventDefault()
    event.stopPropagation()
    startEdit(p)
    return
  }
  const by = KEYS[event.key]
  if (by === undefined || event.metaKey || event.ctrlKey || event.altKey || drag) return
  event.preventDefault()
  event.stopPropagation()
  if (p.feature !== props.selectedId) store.select(p.feature)
  change(target(p), p.handle.by(by, event.shiftKey))
}

/** Typing a value: the field starts with the value as shown, selected. */
function startEdit(p: Placed) {
  if (drag) return
  if (p.feature !== props.selectedId) store.select(p.feature)
  editing.value = { id: p.id, text: p.handle.text, invalid: false }
  void nextTick(() => {
    const field = editor.value[0]
    field?.focus()
    field?.select()
  })
}

/**
 * Applies the typed value as one undo step. From the keyboard (Enter), a value it can't read keeps the field open,
 * marked, and focus goes back to the pill; leaving the field (a click elsewhere) leaves focus where the click put it.
 */
function commitEdit(fromKeyboard: boolean) {
  const typing = editing.value
  if (!typing) return
  const p = find(typing.id)
  const changes = p?.handle.parse(typing.text)
  if (!p || !changes) {
    if (fromKeyboard && p) {
      editing.value = { ...typing, invalid: true }
      return
    }
    editing.value = null
    return
  }
  editing.value = null
  if (change(target(p), changes)) announce(p.id)
  if (fromKeyboard) refocus(p.id)
}

function cancelEdit() {
  const id = editing.value?.id
  editing.value = null
  if (id) refocus(id)
}

/** Back to the pill once it is drawn again, so the keys carry on from it. */
function refocus(id: string) {
  void nextTick(() => props.container?.querySelector<HTMLElement>(`[data-dimension="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }))
}

function onEditKey(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Enter') {
    event.preventDefault()
    commitEdit(true)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancelEdit()
  }
}

/** The status bar explains the sizes while one is hovered, focused, dragged or typed. */
watch(
  () => focused.value !== null || hovered.value !== null || active.value !== null || editing.value !== null,
  (on) => (resizeHintShown.value = on),
)

onBeforeUnmount(() => {
  endDrag()
  resizeHintShown.value = false
})
// Another feature selected, text edited in place or a feature dragged: a drag in progress ends where it is (not when
// the press itself selected the feature the size belongs to).
watch(
  () => [props.selectedId, props.disabled, dragState.value !== null],
  () => {
    if (drag && props.selectedId === drag.owner && !props.disabled && dragState.value === null) return
    endDrag()
  },
)

const tickLines = computed(() => ticks.value?.lines ?? [])
const lit = (p: Placed) => active.value === p.id || focused.value === p.id || hovered.value === p.id
const segment = (s: Segment) => {
  const left = Math.min(s.x1, s.x2)
  const top = Math.min(s.y1, s.y2)
  return { left: `${left}px`, top: `${top}px`, width: `${Math.max(Math.abs(s.x2 - s.x1), 0)}px`, height: `${Math.max(Math.abs(s.y2 - s.y1), 0)}px` }
}
</script>

<template>
  <div class="pointer-events-none absolute inset-0" data-testid="resize-layer">
    <!-- Where a drag snaps to: faint lines across the feature, named for named heights. -->
    <template v-if="ticks">
      <div
        v-for="(line, i) in tickLines"
        :key="i"
        class="absolute border-dashed border-sky-400"
        :class="ticks.axis === 'y' ? 'border-t' : 'border-l'"
        :style="
          ticks.axis === 'y'
            ? { top: `${line.top}px`, left: `${line.left}px`, width: `${line.length}px` }
            : { top: `${line.top}px`, left: `${line.left}px`, height: `${line.length}px` }
        "
        data-testid="resize-tick"
      >
        <span v-if="line.label" class="absolute -top-2.5 left-full ml-1 rounded bg-white px-1 text-[10px] leading-4 text-sky-700">{{ line.label }}</span>
      </div>
    </template>

    <!-- Sizes no input sets: grey, dashed, and saying why. -->
    <div v-for="r in references" :key="r.id" class="absolute inset-0" :class="r.selected ? '' : 'opacity-50'" :data-reference-dimension="r.id">
      <div class="absolute border-dashed border-slate-400" :class="r.drawn.axis === 'y' ? 'border-l' : 'border-t'" :style="segment(r.drawn.line)" />
      <div
        v-for="(e, i) in r.drawn.extensions"
        :key="i"
        class="absolute border-dashed border-slate-300"
        :class="r.drawn.axis === 'y' ? 'border-t' : 'border-l'"
        :style="segment(e)"
      />
      <!-- Not interactive (it would catch clicks meant for the feature under it): it says why in a line beneath. -->
      <span
        class="absolute flex -translate-y-1/2 flex-col"
        :class="
          r.drawn.side === 'right'
            ? '-translate-x-2 items-start'
            : r.drawn.side === 'left'
              ? 'translate-x-[calc(-100%+0.5rem)] items-end'
              : '-translate-x-1/2 items-center'
        "
        :style="{ left: `${r.drawn.pill.x}px`, top: `${r.drawn.pill.y}px` }"
        data-testid="reference-dimension"
      >
        <span class="rounded-full border border-dashed border-slate-400 bg-white px-2 py-0.5 text-[11px] whitespace-nowrap text-slate-500"
          >({{ r.reference.text }})</span
        >
        <span v-if="r.selected" class="mt-0.5 rounded bg-white/90 px-1 text-[10px] whitespace-nowrap text-slate-500">{{ r.reference.why }}</span>
      </span>
    </div>

    <div v-if="placed.length > 0" data-testid="resize-handles">
      <template v-for="p in placed" :key="p.id">
        <!-- The edge itself: a strip to drag, lit while its size is hovered, focused or dragged. -->
        <div
          v-if="p.strip"
          aria-hidden="true"
          class="group pointer-events-auto absolute flex touch-none items-center justify-center"
          :class="p.handle.axis === 'y' ? 'cursor-ns-resize' : 'cursor-ew-resize'"
          :style="{ top: `${p.strip.top}px`, left: `${p.strip.left}px`, width: `${p.strip.width}px`, height: `${p.strip.height}px` }"
          :data-resize-handle="p.handle.key"
          @pointerdown="onPointerDown($event, p)"
          @pointermove="onPointerMove"
          @pointerup="endDrag"
          @pointercancel="endDrag"
          @lostpointercapture="endDrag"
          @pointerenter="hovered = p.id"
          @pointerleave="hovered = hovered === p.id ? null : hovered"
          @click.stop
        >
          <span
            class="absolute bg-sky-500 transition-opacity group-hover:opacity-100"
            :class="[
              p.handle.axis === 'y' ? 'inset-x-0 top-1/2 h-0.5 -translate-y-1/2' : 'inset-y-0 left-1/2 w-0.5 -translate-x-1/2',
              lit(p) ? 'opacity-100' : 'opacity-0',
            ]"
          />
          <span
            class="relative rounded-full border-2 border-sky-500 shadow-sm"
            :class="[p.handle.axis === 'y' ? 'h-2.5 w-10' : 'h-10 w-2.5', active === p.id ? 'bg-sky-500' : 'bg-white group-hover:bg-sky-100']"
          />
        </div>

        <!-- The dimension: its line with end marks, extension lines from the feature, and the value on a pill. -->
        <div class="absolute inset-0" :class="p.selected ? 'z-10' : lit(p) ? 'z-10 opacity-90' : 'opacity-50'" :data-dimension-of="p.feature">
          <div class="absolute border-sky-600" :class="p.drawn.axis === 'y' ? 'border-l-[1.5px]' : 'border-t-[1.5px]'" :style="segment(p.drawn.line)" />
          <div
            v-for="(e, i) in p.drawn.extensions"
            :key="i"
            class="absolute border-sky-500/70"
            :class="p.drawn.axis === 'y' ? 'border-t' : 'border-l'"
            :style="segment(e)"
          />
          <div
            v-for="end in p.drawn.axis === 'y' ? [p.drawn.line.y1, p.drawn.line.y2] : [p.drawn.line.x1, p.drawn.line.x2]"
            :key="end"
            class="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 -rotate-45 border-sky-600"
            :class="p.drawn.axis === 'y' ? 'border-t-[1.5px]' : 'border-l-[1.5px]'"
            :style="p.drawn.axis === 'y' ? { left: `${p.drawn.line.x1}px`, top: `${end}px` } : { left: `${end}px`, top: `${p.drawn.line.y1}px` }"
          />

          <div
            v-if="editing?.id === p.id"
            class="pointer-events-auto absolute z-20 -translate-y-1/2"
            :class="p.drawn.side === 'right' ? '-translate-x-2' : p.drawn.side === 'left' ? 'translate-x-[calc(-100%+0.5rem)]' : '-translate-x-1/2'"
            :style="{ left: `${p.drawn.pill.x}px`, top: `${p.drawn.pill.y}px` }"
            @click.stop
            @pointerdown.stop
          >
            <input
              ref="editor"
              :value="editing.text"
              type="text"
              class="w-32 rounded-md border-2 bg-white px-2 py-1 text-center text-xs font-semibold text-sky-900 shadow-sm outline-none"
              :class="editing.invalid ? 'border-red-500' : 'border-sky-600'"
              :aria-label="p.handle.name"
              :aria-invalid="editing.invalid"
              :aria-describedby="`accepts-${p.id}`"
              data-testid="dimension-input"
              @input="editing = { id: p.id, text: ($event.target as HTMLInputElement).value, invalid: false }"
              @keydown="onEditKey"
              @blur="commitEdit(false)"
            />
            <span
              :id="`accepts-${p.id}`"
              class="absolute top-full left-1/2 mt-1 w-48 -translate-x-1/2 rounded bg-white px-1.5 py-0.5 text-center text-[10px] leading-snug shadow-sm"
              :class="editing.invalid ? 'text-red-700' : 'text-slate-600'"
              >{{ editing.invalid ? `Can't read that. ${p.handle.accepts}.` : p.handle.accepts }}</span
            >
          </div>
          <div
            v-else
            role="slider"
            tabindex="0"
            class="group pointer-events-auto absolute flex -translate-y-1/2 touch-none flex-col outline-none"
            :class="[
              p.handle.axis === 'y' ? 'cursor-ns-resize' : 'cursor-ew-resize',
              p.drawn.side === 'right'
                ? '-translate-x-2 items-start'
                : p.drawn.side === 'left'
                  ? 'translate-x-[calc(-100%+0.5rem)] items-end'
                  : '-translate-x-1/2 items-center',
            ]"
            :style="{ left: `${p.drawn.pill.x}px`, top: `${p.drawn.pill.y}px` }"
            :aria-label="p.handle.name"
            :aria-orientation="p.handle.axis === 'y' ? 'vertical' : 'horizontal'"
            :aria-valuenow="p.handle.now"
            :aria-valuemin="p.handle.min"
            :aria-valuemax="p.handle.max"
            :aria-valuetext="p.handle.note ? `${p.handle.text}, ${p.handle.note}` : p.handle.text"
            :data-dimension="p.id"
            data-testid="dimension"
            @pointerdown="onPointerDown($event, p)"
            @pointermove="onPointerMove"
            @pointerup="endDrag"
            @pointercancel="endDrag"
            @lostpointercapture="endDrag"
            @pointerenter="hovered = p.id"
            @pointerleave="hovered = hovered === p.id ? null : hovered"
            @click.stop
            @dblclick.stop="startEdit(p)"
            @keydown="onKeydown($event, p)"
            @focus="focused = p.id"
            @blur="focused = focused === p.id ? null : focused"
          >
            <span
              class="rounded-full border-[1.5px] border-sky-600 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap shadow-sm group-focus-visible:ring-2 group-focus-visible:ring-sky-500 group-focus-visible:ring-offset-2"
              :class="active === p.id ? 'bg-sky-600 text-white' : 'bg-white text-sky-900 group-hover:bg-sky-50'"
              data-testid="dimension-value"
              >{{ p.handle.label ? `${p.handle.label} = ${p.handle.text}` : p.handle.text }}</span
            >
            <span v-if="p.handle.note" class="mt-0.5 rounded bg-white/90 px-1 text-[10px] whitespace-nowrap text-slate-600" data-testid="dimension-note">{{
              p.handle.note
            }}</span>
          </div>
        </div>
      </template>
    </div>
    <p class="sr-only" aria-live="polite" data-testid="resize-announcement">{{ announcement }}</p>
  </div>
</template>
