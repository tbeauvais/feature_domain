import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import type { Input } from '@atlaskit/pragmatic-drag-and-drop/types'
import { attachInstruction, extractInstruction } from '@atlaskit/pragmatic-drag-and-drop-hitbox/list-item'
import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import { useDocumentStore } from '../stores/document'
import { evaluateDrop, intoSlot, type DragSource, type DropZone } from './dnd'
import { dragState } from './dndState'

// Marks drag data as ours, so other drags (files, text) are ignored.
const OURS = 'featureDomain'
type SourceData = { [OURS]: true; source: DragSource }
type TargetData = { [OURS]: true; zone: DropZone }

const isSource = (data: Record<string | symbol, unknown>): data is SourceData => data[OURS] === true && 'source' in data
const isTarget = (data: Record<string | symbol, unknown>): data is TargetData => data[OURS] === true && 'zone' in data

/**
 * Drag-and-drop for the editor (Pragmatic drag and drop): features on the canvas and in the tree can be dragged and
 * dropped before, after or into each other, or into empty slots; palette items can be dragged in as new features.
 * Every drop is checked with the engine's `canPlace` and applied through the store, so it is validated and undoable.
 * Registrations are rebuilt after each regeneration, since the canvas and tree are re-rendered from the result.
 */
export function useEditorDnd(roots: { canvas: Ref<HTMLElement | null>; tree: Ref<HTMLElement | null>; palette: Ref<HTMLElement | null> }) {
  const store = useDocumentStore()
  let cleanup: () => void = () => {}

  function featureTarget(element: Element, id: string) {
    return dropTargetForElements({
      element,
      canDrop: ({ source }) => isSource(source.data),
      getData: ({ input, element: el }: { input: Input; element: Element }) => {
        const placed = store.model?.features.find((f) => f.id === id)?.placement !== undefined
        const hasSlot = store.result ? intoSlot(store.result, id) !== undefined : false
        const zone: DropZone = { kind: 'feature', id, operation: 'combine' }
        return attachInstruction({ [OURS]: true, zone } satisfies TargetData, {
          input,
          element: el,
          axis: 'vertical',
          operations: { 'reorder-before': placed ? 'available' : 'not-available', 'reorder-after': placed ? 'available' : 'not-available', combine: hasSlot ? 'available' : 'not-available' },
        })
      },
    })
  }

  function register() {
    cleanup()
    const parts: (() => void)[] = []
    const canvas = roots.canvas.value
    if (canvas) {
      for (const el of canvas.querySelectorAll<HTMLElement>('[data-feature-id]')) {
        const id = el.getAttribute('data-feature-id')!
        parts.push(draggable({ element: el, getInitialData: () => ({ [OURS]: true, source: { kind: 'feature', id } }) satisfies SourceData }))
        parts.push(featureTarget(el, id))
      }
      // Slots that are not themselves features (container cells, panel bodies, the document root): append.
      for (const el of canvas.querySelectorAll<HTMLElement>('[data-slot]:not([data-feature-id])')) {
        const zone: DropZone = { kind: 'slot', parent: el.getAttribute('data-slot-parent')!, slot: el.getAttribute('data-slot')! }
        parts.push(dropTargetForElements({ element: el, canDrop: ({ source }) => isSource(source.data), getData: () => ({ [OURS]: true, zone }) satisfies TargetData }))
      }
    }
    for (const el of roots.tree.value?.querySelectorAll<HTMLElement>('[data-tree-id]') ?? []) {
      const id = el.getAttribute('data-tree-id')!
      const placeable = store.result?.metadata.features.find((f) => f.id === id)?.placement !== undefined
      if (placeable) parts.push(draggable({ element: el, getInitialData: () => ({ [OURS]: true, source: { kind: 'feature', id } }) satisfies SourceData }))
      parts.push(featureTarget(el, id))
    }
    for (const el of roots.palette.value?.querySelectorAll<HTMLElement>('[data-palette-type]') ?? []) {
      const featureType = el.getAttribute('data-palette-type')!
      parts.push(draggable({ element: el, getInitialData: () => ({ [OURS]: true, source: { kind: 'palette', featureType } }) satisfies SourceData }))
    }
    cleanup = parts.length > 0 ? combine(...parts) : () => {}
  }

  function update(source: DragSource, targets: { data: Record<string | symbol, unknown>; element: Element }[]) {
    const target = targets.find((t) => isTarget(t.data))
    let zone: DropZone | null = null
    if (target && isTarget(target.data)) {
      zone = target.data.zone
      if (zone.kind === 'feature') {
        const instruction = extractInstruction(target.data)
        zone = instruction ? { kind: 'feature', id: zone.id, operation: instruction.operation } : null
      }
    }
    const evaluation = zone && store.model && store.result ? evaluateDrop(store.model, store.result, source, zone) : null
    const surface = target ? (roots.canvas.value?.contains(target.element) ? 'canvas' : roots.tree.value?.contains(target.element) ? 'tree' : null) : null
    dragState.value = { source, zone, evaluation, element: target?.element ?? null, surface }
  }

  let stopMonitor: () => void = () => {}
  onMounted(() => {
    register()
    stopMonitor = monitorForElements({
      canMonitor: ({ source }) => isSource(source.data),
      onDragStart: ({ source, location }) => isSource(source.data) && update(source.data.source, location.current.dropTargets),
      onDrag: ({ source, location }) => isSource(source.data) && update(source.data.source, location.current.dropTargets),
      onDrop: ({ source, location }) => {
        if (isSource(source.data)) update(source.data.source, location.current.dropTargets)
        const state = dragState.value
        dragState.value = null
        const evaluation = state?.evaluation
        if (!state || !evaluation?.allowed || evaluation.noop) return
        if (state.source.kind === 'feature') {
          store.moveTo(state.source.id, evaluation.target)
          store.select(state.source.id)
        } else {
          store.addAt(state.source.featureType, evaluation.target)
        }
      },
    })
  })
  watch(() => [store.result, roots.canvas.value, roots.tree.value, roots.palette.value], register, { flush: 'post' })
  onBeforeUnmount(() => {
    cleanup()
    stopMonitor()
    dragState.value = null
  })
}
