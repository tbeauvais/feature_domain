import { loadPref, savePref } from './prefs'

/**
 * Canvas widths the editor offers. Tablet and Phone are fixed widths (the canvas scrolls sideways when there's less
 * room), so they show those devices even in a small window; Desktop fills the space. The generated page sizes itself
 * from its own width (container queries).
 */
export const CANVAS_WIDTHS = {
  desktop: { label: 'Desktop', width: undefined },
  tablet: { label: 'Tablet', width: '820px' },
  phone: { label: 'Phone', width: '390px' },
} as const

export type CanvasWidth = keyof typeof CANVAS_WIDTHS

const KEYS = Object.keys(CANVAS_WIDTHS) as CanvasWidth[]

/** The width chosen last time in this browser. */
export const loadCanvasWidth = (): CanvasWidth => loadPref('canvas-width', KEYS, 'desktop')

export const saveCanvasWidth = (width: CanvasWidth): void => savePref('canvas-width', width)
