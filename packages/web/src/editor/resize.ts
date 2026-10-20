import { clamp, type Align } from '@feature-domain/engine'

// Pure mappings from a pointer position (or an arrow key) to an input value, for the resize handles on the canvas
// (`ResizeHandles.vue`). Positions are in pixels in any one coordinate space; the caller measures the page.

/** A pointer must move this far from where it was pressed before a drag changes anything (a click changes nothing). */
export const DRAG_THRESHOLD = 3
/** A snapped value changes only once the pointer is this much nearer the next one, so it doesn't flicker on a boundary. */
export const SNAP_HYSTERESIS = 6

/**
 * The index of the position nearest `at`, keeping `current` until another is nearer by `SNAP_HYSTERESIS` (ties go to
 * the earlier one).
 */
export function nearestIndex(positions: readonly number[], at: number, current = -1): number {
  let best = 0
  for (let i = 1; i < positions.length; i++) if (Math.abs(positions[i]! - at) < Math.abs(positions[best]! - at)) best = i
  if (current >= 0 && current < positions.length && best !== current) {
    if (Math.abs(positions[current]! - at) <= Math.abs(positions[best]! - at) + SNAP_HYSTERESIS) return current
  }
  return best
}

/** The step whose height is nearest `height`, keeping `current` near a boundary. `heights` lists the steps in order. */
export function nearestStep<T extends string>(heights: Readonly<Record<T, number>>, height: number, current?: T): T {
  const steps = Object.keys(heights) as T[]
  return steps[
    nearestIndex(
      steps.map((s) => heights[s]),
      height,
      current === undefined ? -1 : steps.indexOf(current),
    )
  ]!
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

/**
 * The width something takes when its handle is at `x`: the handle is on the right edge, or the left one when it is
 * right-aligned, and a centered one grows on both sides, so it is twice the distance from its center.
 */
export function widthAt(align: Align, box: { left: number; width: number }, x: number): number {
  return align === 'right' ? box.left + box.width - x : align === 'center' ? 2 * (x - (box.left + box.width / 2)) : x - box.left
}

/** Image widths are whole pixels, rounded to `step` (`fine`: 1 px), from `min` to the room the image has. */
export const IMAGE_WIDTH = { step: 10, fine: 1, min: 20 } as const

function roundWidth(width: number, max: number, fine: boolean): number {
  const step = fine ? IMAGE_WIDTH.fine : IMAGE_WIDTH.step
  const limit = Math.max(IMAGE_WIDTH.min, Math.floor(max))
  return clamp(Math.round(width / step) * step, IMAGE_WIDTH.min, limit)
}

export function imageWidthAt(align: Align, box: { left: number; width: number }, x: number, max: number, fine = false): number {
  return roundWidth(widthAt(align, box, x), max, fine)
}

/** The width `by` arrow key presses make: that many steps wider or narrower, from the nearest step. */
export function imageWidthBy(width: number, by: number, max: number, fine = false): number {
  const step = fine ? IMAGE_WIDTH.fine : IMAGE_WIDTH.step
  const next = by > 0 ? Math.floor(width / step + 1e-9) * step + by * step : Math.ceil(width / step - 1e-9) * step + by * step
  return roundWidth(next, max, fine)
}

/** Separator widths are a percentage of the room, in steps of 5 (`fine`: 1), from 5 to 100. */
export const PERCENT_WIDTH = { step: 5, fine: 1, min: 5, max: 100 } as const

function roundPercent(percent: number, fine: boolean): number {
  const step = fine ? PERCENT_WIDTH.fine : PERCENT_WIDTH.step
  return clamp(Math.round(percent / step) * step, PERCENT_WIDTH.min, PERCENT_WIDTH.max)
}

export function percentWidthAt(align: Align, box: { left: number; width: number }, x: number, room: number, fine = false): number {
  return room > 0 ? roundPercent((widthAt(align, box, x) / room) * 100, fine) : PERCENT_WIDTH.max
}

export function percentWidthBy(percent: number, by: number, fine = false): number {
  return roundPercent(percent + by * (fine ? PERCENT_WIDTH.fine : PERCENT_WIDTH.step), fine)
}

/**
 * Where `x` falls along a grid's columns, as a fraction of their width without the gaps, for the edge after column
 * `edge` (1-based), which sits in the middle of the gap after it. `span` runs from the first column's left edge to the
 * last one's right edge (not the grid's box, whose padding is no column).
 */
export function trackFraction(x: number, span: { left: number; width: number }, gap: number, columns: number, edge: number): number {
  const tracks = span.width - gap * (columns - 1)
  if (tracks <= 0) return NaN
  return (x - span.left - gap * (edge - 1) - gap / 2) / tracks
}

/** A table shows at least this many rows before it scrolls (0: every row, no scroll box). */
export const SCROLL_ROWS = { min: 3, max: 100 } as const

function rowsOrAll(rows: number, rowCount: number): number {
  const n = Math.max(rows, SCROLL_ROWS.min)
  return n > Math.min(rowCount, SCROLL_ROWS.max) ? 0 : n
}

/**
 * A table's Scroll after when the bottom of its scroll box is dragged `height` below its top, with its rows' bottoms
 * measured from the same top (`bottoms`, header included): the nearest row bottom, keeping `current` near a boundary;
 * more than half the last row past its bottom, 0: every row shows.
 */
export function scrollRowsAt(height: number, bottoms: readonly number[], current = 0): number {
  const count = bottoms.length
  if (count === 0) return 0
  const last = bottoms[count - 1]!
  const lastRow = last - (bottoms[count - 2] ?? 0)
  if (height > last + lastRow / 2) return 0
  const at = nearestIndex(bottoms, height, current > 0 ? current - 1 : -1)
  return rowsOrAll(at + 1, count)
}

/**
 * Scroll after while no rows are loaded (or none could be): the box is the header and that many rows of `rowHeight`
 * (the estimate document.css sizes it by until rows arrive), so the nearest whole row.
 */
export function scrollRowsEstimated(height: number, rowHeight: number): number {
  return rowsOrAll(Math.round(height / rowHeight) - 1, Infinity)
}

/** Scroll after `by` arrow key presses away: rows more or less, where 0 (every row) is one past the last row. */
export function scrollRowsBy(current: number, by: number, rowCount: number): number {
  const shown = current === 0 ? Math.min(rowCount, SCROLL_ROWS.max) + 1 : current
  return rowsOrAll(shown + by, rowCount)
}

export const scrollRowsText = (rows: number) => (rows === 0 ? 'All rows' : `${rows} rows`)
export const sharesText = (shares: readonly number[]) => shares.join(' : ')
export const stepText = (step: string) => step[0]!.toUpperCase() + step.slice(1)
