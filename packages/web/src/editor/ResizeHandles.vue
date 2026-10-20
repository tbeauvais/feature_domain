<script setup lang="ts">
import { defaultRegistry, resolveInputs, type InputValue } from '@feature-domain/engine'
import { nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useDocumentStore } from '../stores/document'
import { resizeHandles, type ResizeHandle } from './resizeHandles'
import { useRemeasure } from './useRemeasure'

// Handles on the selected feature's edges that change its sizes: dragging one (or the arrow keys on a focused one)
// only edits inputs, and the page regenerates from them. Like the selection outline, they live outside the generated
// page (.fd-root), positioned from bounding boxes. Off while text is edited in place (`disabled`).
const props = defineProps<{ container: HTMLElement | null; selectedId: string | null; version: unknown; disabled?: boolean }>()

const store = useDocumentStore()
const handles = shallowRef<{ handle: ResizeHandle; top: number; left: number }[]>([])
/** The drag in progress: its handle, the feature and the undo gesture its changes form. */
let drag: { key: string; feature: string; gesture: string; pointer: number; element: HTMLElement; cancelled?: boolean } | null = null
let gestures = 0
const active = ref<string | null>(null)
const focused = ref<string | null>(null)

const { observe } = useRemeasure(() => props.container, measure)

function instance(id: string | null) {
  return id === null ? undefined : store.model?.features.find((f) => f.id === id)
}

function measure() {
  const container = props.container
  const feature = props.disabled ? undefined : instance(props.selectedId)
  const def = feature ? defaultRegistry.get(feature.feature) : undefined
  observe(feature && container ? container.querySelector(`[data-feature-id="${CSS.escape(feature.id)}"]`) : null)
  if (!container || !feature || !def) {
    handles.value = []
    return
  }
  const outer = container.getBoundingClientRect()
  // Absolute positions are relative to the container's padding box, inside its border.
  const x = (clientX: number) => clientX - outer.left - container.clientLeft + container.scrollLeft
  const y = (clientY: number) => clientY - outer.top - container.clientTop + container.scrollTop
  handles.value = resizeHandles(container, feature.feature, feature.id, resolveInputs(def.inputs, feature.inputs)).map((handle) => ({
    handle,
    top: y(handle.edge.y),
    left: x(handle.edge.x),
  }))
}

watch(
  () => [props.container, props.selectedId, props.version, props.disabled],
  () => void nextTick(measure),
  { immediate: true },
)

/** Applies a handle's changes, unless they change nothing (a drag along the same step, a key at the end). */
function change(feature: string, changes: Record<string, InputValue>, gesture?: string) {
  const current = instance(feature)
  const def = current ? defaultRegistry.get(current.feature) : undefined
  if (!current || !def) return
  const inputs = resolveInputs(def.inputs, current.inputs)
  if (Object.entries(changes).every(([name, value]) => inputs[name] === value)) return
  store.setInputs(feature, changes, gesture)
}

function onPointerDown(event: PointerEvent, handle: ResizeHandle) {
  if (event.button !== 0 || props.selectedId === null) return
  // Not a text selection, a feature drag or a click that selects something else.
  event.preventDefault()
  event.stopPropagation()
  const element = event.currentTarget as HTMLElement
  element.setPointerCapture(event.pointerId)
  drag = { key: handle.key, feature: props.selectedId, gesture: `resize-${++gestures}`, pointer: event.pointerId, element }
  active.value = handle.key
  window.addEventListener('keydown', onDragKey, true)
}

function onPointerMove(event: PointerEvent) {
  if (!drag || drag.cancelled || event.pointerId !== drag.pointer) return
  const handle = handles.value.find((h) => h.handle.key === drag!.key)?.handle
  if (handle) change(drag.feature, handle.at(event.clientX, event.clientY, event.shiftKey), drag.gesture)
}

function endDrag() {
  if (!drag) return
  if (drag.element.hasPointerCapture(drag.pointer)) drag.element.releasePointerCapture(drag.pointer)
  window.removeEventListener('keydown', onDragKey, true)
  drag = null
  active.value = null
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
}

const KEYS: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }

function onKeydown(event: KeyboardEvent, handle: ResizeHandle) {
  // Enter would edit the feature's text in place; the handle has nothing to edit.
  if (event.key === 'Enter') {
    event.stopPropagation()
    return
  }
  const by = KEYS[event.key]
  if (by === undefined || event.metaKey || event.ctrlKey || event.altKey || props.selectedId === null) return
  event.preventDefault()
  event.stopPropagation()
  change(props.selectedId, handle.by(by, event.shiftKey))
}

onBeforeUnmount(endDrag)
// Another feature selected, or text edited in place: a drag in progress ends where it is.
watch(
  () => [props.selectedId, props.disabled],
  () => endDrag(),
)
</script>

<template>
  <div v-if="handles.length > 0" class="pointer-events-none absolute inset-0" data-testid="resize-handles">
    <div
      v-for="{ handle, top, left } in handles"
      :key="handle.key"
      role="slider"
      tabindex="0"
      class="pointer-events-auto absolute touch-none rounded-full border-2 border-sky-500 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
      :class="[
        handle.axis === 'y' ? 'h-2.5 w-10 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize' : 'h-10 w-2.5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize',
        active === handle.key ? 'bg-sky-500' : 'bg-white hover:bg-sky-100',
      ]"
      :style="{ top: `${top}px`, left: `${left}px` }"
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
      @click.stop
      @keydown="onKeydown($event, handle)"
      @focus="focused = handle.key"
      @blur="focused = focused === handle.key ? null : focused"
    >
      <span
        v-if="active === handle.key || focused === handle.key"
        class="pointer-events-none absolute rounded bg-slate-900 px-1.5 py-0.5 text-xs whitespace-nowrap text-white"
        :class="handle.axis === 'y' ? 'top-full left-1/2 mt-1.5 -translate-x-1/2' : 'top-1/2 left-full ml-1.5 -translate-y-1/2'"
        aria-hidden="true"
        data-testid="resize-value"
        >{{ handle.text }}</span
      >
    </div>
  </div>
</template>
