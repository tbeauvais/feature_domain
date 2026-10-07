/** Canvas widths the editor offers. The generated page sizes itself from its own width (container queries). */
export const CANVAS_WIDTHS = {
  desktop: { label: 'Desktop', maxWidth: 'none' },
  tablet: { label: 'Tablet', maxWidth: '820px' },
  phone: { label: 'Phone', maxWidth: '390px' },
} as const

export type CanvasWidth = keyof typeof CANVAS_WIDTHS

const KEY = 'feature-domain:canvas-width'

/** The width chosen last time (a per-browser convenience; storage may be unavailable). */
export function loadCanvasWidth(): CanvasWidth {
  try {
    const stored = localStorage.getItem(KEY)
    return stored !== null && stored in CANVAS_WIDTHS ? (stored as CanvasWidth) : 'desktop'
  } catch {
    return 'desktop'
  }
}

export function saveCanvasWidth(width: CanvasWidth): void {
  try {
    localStorage.setItem(KEY, width)
  } catch {
    // Not remembered; nothing else depends on it.
  }
}
