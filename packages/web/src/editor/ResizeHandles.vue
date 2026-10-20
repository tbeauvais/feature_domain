<script setup lang="ts">
import { defaultRegistry, resolveInputs, type InputValue } from '@feature-domain/engine'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useDocumentStore } from '../stores/document'
import { dragState } from './dndState'
import { DRAG_THRESHOLD } from './resize'
import { resizeHandles, type ResizeHandle, type Tick } from './resizeHandles'
import { resizeHintShown } from './resizeState'
import { useRemeasure } from './useRemeasure'

// Handles on the selected feature's edges that change its sizes: dragging one (or the arrow keys on a focused one)
// only edits inputs, and the page regenerates from them. Like the selection outline, they live outside the generated
// page (.fd-root), positioned from bounding boxes. Each handle is the whole edge (a strip with a grip in its middle).
// Off while text is edited in place (`disabled`) and while a feature is dragged (so a drop never lands on a handle).
const props = defineProps<{ container: HTMLElement | null; selectedId: string | null; version: unknown; disabled?: boolean }>()

const store = useDocumentStore()

/** How thick a handle's strip is, and the shortest it is drawn (a separator's rule is a pixel high). */
const STRIP = 12
const MIN_LENGTH = 40
/** Within this distance of the canvas's scrolling edge, a drag scrolls it (pixels per frame at the very edge). */
const SCROLL_ZONE = 40
const SCROLL_SPEED = 16

interface Placed {
  handle: ResizeHandle
  /** The strip, relative to the container. */
  box: { top: number; left: number; width: number; height: number }
}

const placed = shallowRef<Placed[]>([])
/** The drag in progress, from press to release. `moved`: past the threshold; `cancelled`: Escape put the value back. */
let drag: {
  key: string
  feature: string
  gesture: string
  pointer: number
  element: HTMLElement
  start: { x: number; y: number }
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

const { observe } = useRemeasure(() => props.container, measure)

const instance = (id: string | null) => (id === null ? undefined : store.model?.features.find((f) => f.id === id))

/** Client coordinates to the container's padding box (where absolutely positioned overlays sit). */
function toContainer(container: HTMLElement) {
  const outer = container.getBoundingClientRect()
  return {
    x: (clientX: number) => clientX - outer.left - container.clientLeft + container.scrollLeft,
    y: (clientY: number) => clientY - outer.top - container.clientTop + container.scrollTop,
  }
}

function measure() {
  const container = props.container
  const feature = props.disabled || dragState.value !== null ? undefined : instance(props.selectedId)
  const def = feature ? defaultRegistry.get(feature.feature) : undefined
  observe(feature && container ? container.querySelector(`[data-feature-id="${CSS.escape(feature.id)}"]`) : null)
  if (!container || !feature || !def) {
    placed.value = []
    ticks.value = null
    focused.value = hovered.value = null
    return
  }
  const name = typeof feature.inputs.name === 'string' && feature.inputs.name.trim() !== '' ? feature.inputs.name.trim() : def.name
  const at = toContainer(container)
  placed.value = resizeHandles(container, feature.feature, feature.id, resolveInputs(def.inputs, feature.inputs), name).map((handle) => {
    const length = Math.max(handle.edge.length, MIN_LENGTH)
    const x = at.x(handle.edge.x)
    const y = at.y(handle.edge.y)
    return {
      handle,
      box:
        handle.axis === 'y'
          ? { top: y - STRIP / 2, left: x - length / 2, width: length, height: STRIP }
          : { top: y - length / 2, left: x - STRIP / 2, width: STRIP, height: length },
    }
  })
  // A handle that went away (another feature selected) takes its hover and focus state with it.
  const keys = new Set(placed.value.map((p) => p.handle.key))
  if (focused.value !== null && !keys.has(focused.value)) focused.value = null
  if (hovered.value !== null && !keys.has(hovered.value)) hovered.value = null
  ticks.value = drag?.moved && !drag.cancelled ? measureTicks(container) : null
}

/** The snap marks of the handle being dragged, as lines across the feature. */
function measureTicks(container: HTMLElement) {
  const handle = placed.value.find((p) => p.handle.key === drag?.key)?.handle
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
  () => [props.container, props.selectedId, props.version, props.disabled, dragState.value === null],
  () => void nextTick(measure),
  { immediate: true },
)

/** Applies a handle's changes, unless they change nothing (a drag within one step, a key at the end). */
function change(feature: string, changes: Record<string, InputValue>, gesture?: string): boolean {
  const current = instance(feature)
  const def = current ? defaultRegistry.get(current.feature) : undefined
  if (!current || !def) return false
  const inputs = resolveInputs(def.inputs, current.inputs)
  if (Object.entries(changes).every(([name, value]) => inputs[name] === value)) return false
  store.setInputs(feature, changes, gesture)
  return true
}

function onPointerDown(event: PointerEvent, handle: ResizeHandle) {
  // One drag at a time, with the primary button (a second finger or button is ignored).
  if (event.button !== 0 || drag || props.selectedId === null) return
  // Not a text selection, a feature drag or a click that selects something else.
  event.preventDefault()
  event.stopPropagation()
  const element = event.currentTarget as HTMLElement
  element.setPointerCapture(event.pointerId)
  // The press focuses the handle, so the arrow keys carry on from it (preventDefault above stops the browser's focus).
  element.focus({ preventScroll: true })
  const point = { x: event.clientX, y: event.clientY }
  drag = {
    key: handle.key,
    feature: props.selectedId,
    gesture: `resize-${++gestures}`,
    pointer: event.pointerId,
    element,
    start: point,
    last: { ...point, fine: event.shiftKey },
    moved: false,
    cancelled: false,
    changed: false,
  }
  active.value = handle.key
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
 * (and keeps going while the pointer stays there), so a handle below the fold can be dragged further.
 */
function step() {
  frame = 0
  if (!drag || drag.cancelled) return
  const handle = placed.value.find((p) => p.handle.key === drag!.key)?.handle
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
  if (handle && change(drag.feature, handle.at(drag.last.x, drag.last.y, drag.last.fine), drag.gesture)) drag.changed = true
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
  const { key, changed, cancelled } = drag
  drag = null
  active.value = null
  ticks.value = null
  if (changed && !cancelled) announce(key)
}

/** Says the value a drag left, once the page has regenerated (a slider's value text is read only while it is focused). */
function announce(key: string) {
  void nextTick(() => {
    measure()
    const handle = placed.value.find((p) => p.handle.key === key)?.handle
    if (handle) announcement.value = `${handle.name}: ${handle.text}`
  })
}

/**
 * Escape during a drag puts the value back (and nothing is left to undo). The handle keeps the pointer until the button
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

/** Arrow keys step a handle; Page Up / Down take five steps, Home / End go to the ends. */
const KEYS: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 5, PageDown: -5, End: 1000, Home: -1000 }

function onKeydown(event: KeyboardEvent, handle: ResizeHandle) {
  // Enter would edit the feature's text in place; the handle has nothing to edit.
  if (event.key === 'Enter') {
    event.stopPropagation()
    return
  }
  const by = KEYS[event.key]
  if (by === undefined || event.metaKey || event.ctrlKey || event.altKey || props.selectedId === null || drag) return
  event.preventDefault()
  event.stopPropagation()
  change(props.selectedId, handle.by(by, event.shiftKey))
}

/** The value shows beside a handle while it is dragged, focused or hovered. */
const shown = (key: string) => active.value === key || focused.value === key || (hovered.value === key && active.value === null)
watch(
  () => focused.value !== null || hovered.value !== null || active.value !== null,
  (on) => (resizeHintShown.value = on),
)

onBeforeUnmount(() => {
  endDrag()
  resizeHintShown.value = false
})
// Another feature selected, text edited in place or a feature dragged: a drag in progress ends where it is.
watch(
  () => [props.selectedId, props.disabled, dragState.value !== null],
  () => endDrag(),
)

const tickLines = computed(() => ticks.value?.lines ?? [])
</script>

<template>
  <div class="pointer-events-none absolute inset-0" data-testid="resize-layer">
    <!-- Where a drag snaps to: faint lines across the feature, named for stepped heights. -->
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

    <div v-if="placed.length > 0" data-testid="resize-handles">
      <div
        v-for="{ handle, box } in placed"
        :key="handle.key"
        role="slider"
        tabindex="0"
        class="group pointer-events-auto absolute flex touch-none items-center justify-center outline-none"
        :class="handle.axis === 'y' ? 'cursor-ns-resize' : 'cursor-ew-resize'"
        :style="{ top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px` }"
        :aria-label="handle.name"
        :aria-orientation="handle.axis === 'y' ? 'vertical' : 'horizontal'"
        :aria-valuenow="handle.now"
        :aria-valuemin="handle.min"
        :aria-valuemax="handle.max"
        :aria-valuetext="handle.text"
        :data-resize-handle="handle.key"
        @pointerdown="onPointerDown($event, handle)"
        @pointermove="onPointerMove"
        @pointerup="endDrag"
        @pointercancel="endDrag"
        @lostpointercapture="endDrag"
        @pointerenter="hovered = handle.key"
        @pointerleave="hovered = hovered === handle.key ? null : hovered"
        @click.stop
        @keydown="onKeydown($event, handle)"
        @focus="focused = handle.key"
        @blur="focused = focused === handle.key ? null : focused"
      >
        <!-- The edge lights up while the handle is hovered, focused or dragged. -->
        <span
          class="absolute bg-sky-500 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          :class="[
            handle.axis === 'y' ? 'inset-x-0 top-1/2 h-0.5 -translate-y-1/2' : 'inset-y-0 left-1/2 w-0.5 -translate-x-1/2',
            active === handle.key ? 'opacity-100' : 'opacity-0',
          ]"
          aria-hidden="true"
        />
        <span
          class="relative rounded-full border-2 border-sky-500 shadow-sm group-focus-visible:ring-2 group-focus-visible:ring-sky-500 group-focus-visible:ring-offset-2"
          :class="[handle.axis === 'y' ? 'h-2.5 w-10' : 'h-10 w-2.5', active === handle.key ? 'bg-sky-500' : 'bg-white group-hover:bg-sky-100']"
          aria-hidden="true"
        />
        <span
          v-if="shown(handle.key)"
          class="pointer-events-none absolute z-10 rounded bg-slate-900 px-1.5 py-0.5 text-xs whitespace-nowrap text-white"
          :class="handle.axis === 'y' ? 'top-full left-1/2 mt-1 -translate-x-1/2' : 'top-1/2 left-full ml-1 -translate-y-1/2'"
          aria-hidden="true"
          data-testid="resize-value"
          >{{ handle.text }}</span
        >
      </div>
    </div>
    <p class="sr-only" aria-live="polite" data-testid="resize-announcement">{{ announcement }}</p>
  </div>
</template>
