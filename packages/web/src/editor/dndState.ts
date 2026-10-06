import { shallowRef } from 'vue'
import type { DragSource, DropEvaluation, DropZone } from './dnd'

export interface DragState {
  source: DragSource
  /** The hovered drop zone, if any, and what dropping there would do. */
  zone: DropZone | null
  evaluation: DropEvaluation | null
  /** The hovered drop target element, and which editor surface it belongs to. */
  element: Element | null
  surface: 'canvas' | 'tree' | null
}

/** The drag in progress, shared by the canvas indicator and the feature tree. */
export const dragState = shallowRef<DragState | null>(null)
