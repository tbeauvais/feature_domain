import { clamp, type Align } from '@feature-domain/engine'

// Pure mappings from a pointer position (or an arrow key) to an input value, for the resize handles on the canvas
// (`ResizeHandles.vue`). Positions are in pixels in any one coordinate space; the caller measures the page.

/** The step whose height is nearest `height` (ties go to the earlier step). `heights` lists the steps in order. */
export function nearestStep<T extends string>(heights: Readonly<Record<T, number>>, height: number): T {
  const steps = Object.keys(heights) as T[]
  let best = steps[0]!
  for (const step of steps) if (Math.abs(heights[step] - height) < Math.abs(heights[best] - height)) best = step
  return best
}

/** The step `by` places after `current` in `order`, staying at the ends. */
export function stepBy<T>(order: readonly T[], current: T, by: number): T {
  const at = Math.max(0, order.indexOf(current))
  return order[clamp(at + by, 0, order.length - 1)]!
}

/** Heights of shapes given as width / height (banner and map heights) at this width. */
export function aspectHeights<T extends string>(aspects: Readonly<Record<T, number>>, width: number): Record<T, number> {
  const out = {} as Record<T, number>
  for (const step of Object.keys(aspects) as T[]) out[step] = width / aspects[step]
  return out
}

/** Image widths are whole pixels, rounded to `step` (`fine`: 1 px), from `min` to the space the image has. */
export const IMAGE_WIDTH = { step: 10, fine: 1, min: 20 } as const

function roundWidth(width: number, max: number, fine: boolean): number {
  const step = fine ? IMAGE_WIDTH.fine : IMAGE_WIDTH.step
  const limit = Math.max(IMAGE_WIDTH.min, Math.floor(max))
  return clamp(Math.round(width / step) * step, IMAGE_WIDTH.min, limit)
}

/**
 * The width an image takes when its handle is at `x`: the handle is on the right edge, or the left one for a
 * right-aligned image, and a centered image grows on both sides, so it is twice the distance from its center.
 */
export function imageWidthAt(align: Align, box: { left: number; width: number }, x: number, max: number, fine = false): number {
  const width = align === 'right' ? box.left + box.width - x : align === 'center' ? 2 * (x - (box.left + box.width / 2)) : x - box.left
  return roundWidth(width, max, fine)
}

/** The width one arrow key press makes: a step wider or narrower, from the nearest step. */
export function imageWidthBy(width: number, by: number, max: number, fine = false): number {
  const step = fine ? IMAGE_WIDTH.fine : IMAGE_WIDTH.step
  const next = by > 0 ? Math.floor(width / step + 1e-9) * step + step : Math.ceil(width / step - 1e-9) * step - step
  return roundWidth(next, max, fine)
}

/**
 * Where `x` falls along a grid's columns, as a fraction of their width without the gaps, for the edge after column
 * `edge` (1-based), which sits in the middle of the gap after it.
 */
export function trackFraction(x: number, grid: { left: number; width: number }, gap: number, columns: number, edge: number): number {
  const tracks = grid.width - gap * (columns - 1)
  if (tracks <= 0) return NaN
  return (x - grid.left - gap * (edge - 1) - gap / 2) / tracks
}

/** A table shows at least this many rows before it scrolls (0: every row, no scroll box). */
export const SCROLL_ROWS = { min: 3, max: 100 } as const

function rowsOrAll(rows: number, rowCount: number): number {
  const n = clamp(rows, SCROLL_ROWS.min, SCROLL_ROWS.max)
  return n > rowCount ? 0 : n
}

/**
 * A table's Scroll after when the bottom of its scroll box is dragged `height` below its top. The box is the header and
 * that many rows, `rowHeight` each (as document.css sizes it), so the nearest whole row; past the rows it has loaded
 * (or half a row past the bottom of its content, `contentHeight`, since real rows can be shorter), 0: every row shows.
 */
export function scrollRowsAt(height: number, rowHeight: number, rowCount: number, contentHeight = Infinity): number {
  if (height > contentHeight + rowHeight / 2) return 0
  return rowsOrAll(Math.round(height / rowHeight) - 1, rowCount)
}

/** Scroll after one arrow key press away: a row more or less, where 0 (every row) is one past the last row. */
export function scrollRowsBy(current: number, by: number, rowCount: number): number {
  const shown = current === 0 ? Math.min(rowCount, SCROLL_ROWS.max) + 1 : current
  return rowsOrAll(shown + by, rowCount)
}

export const scrollRowsText = (rows: number) => (rows === 0 ? 'All rows' : `${rows} rows`)
export const sharesText = (shares: readonly number[]) => shares.join(' : ')
export const stepText = (step: string) => step[0]!.toUpperCase() + step.slice(1)
