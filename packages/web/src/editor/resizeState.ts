import { ref, watch } from 'vue'
import { loadPref, savePref } from './prefs'

/** A size on the canvas is hovered, focused, dragged or typed, so the status bar shows how to use it. */
export const resizeHintShown = ref(false)

/** Whose dimensions the canvas shows: the selected feature's, or every feature's (remembered per browser). */
export const DIMENSIONS_SHOWN = ['selected', 'all'] as const
export type DimensionsShown = (typeof DIMENSIONS_SHOWN)[number]
export const dimensionsShown = ref<DimensionsShown>(loadPref('dimensions', DIMENSIONS_SHOWN, 'selected'))
watch(dimensionsShown, (value) => savePref('dimensions', value))
