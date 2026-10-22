import { clamp, NAMED_HEIGHTS, snapHeight, snapWidth, type Align, type Height, type HeightScale, type Width, type WidthScale } from '@feature-domain/engine'

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

/** A drag sticks to a named height while the edge is within this many pixels of it. */
export const DETENT = 8

/** A height's size in pixels at this width (a % of the width, or pixels). */
export const heightPx = (height: Height, scale: HeightScale, width: number) => (scale.unit === '%' ? (width * height.value) / 100 : height.value)

/**
 * The height when the bottom edge is dragged `px` below the top of something `width` wide: a named height while within
 * `DETENT` of one (the current name keeps it a little further), else the nearest step of the scale.
 */
export function heightAt(px: number, width: number, scale: HeightScale, current?: Height): Height {
  for (const name of NAMED_HEIGHTS) {
    const reach = name === current?.name ? DETENT + SNAP_HYSTERESIS : DETENT
    if (Math.abs(heightPx({ value: scale.named[name] }, scale, width) - px) <= reach) return { value: scale.named[name], name }
  }
  const value = scale.unit === '%' ? (width > 0 ? (px / width) * 100 : scale.named.medium) : px
  return { value: snapHeight(value, scale) }
}

/**
 * The height `by` arrow key presses make: that many steps of the scale (from a named height, to the whole step past
 * it), or with `toNamed` the next named height that way (staying at the last one).
 */
export function heightBy(current: Height, by: number, scale: HeightScale, toNamed = false): Height {
  if (toNamed) {
    const names = by > 0 ? NAMED_HEIGHTS : [...NAMED_HEIGHTS].reverse()
    const next = names.find((name) => (by > 0 ? scale.named[name] > current.value + 1e-9 : scale.named[name] < current.value - 1e-9))
    return next ? { value: scale.named[next], name: next } : current
  }
  const steps = current.value / scale.step
  const from = by > 0 ? Math.floor(steps + 1e-9) : Math.ceil(steps - 1e-9)
  return { value: snapHeight((from + by) * scale.step, scale) }
}

/**
 * A width dragged to `px` where `room` is the most it can show: snapped to the scale, or `full` once it reaches the
 * room. `keep`: a stored width at least as wide as the room (or full), kept when the drag reaches the room, so a
 * narrow canvas never quietly narrows a wider setting.
 */
export function limitWidthAt(px: number, room: number, scale: WidthScale, keep?: Width): Width {
  if (px >= room - scale.step / 2) return keep === 'full' || (keep !== undefined && keep >= room) ? keep : 'full'
  return snapWidth(px, scale)
}

/** The width `by` arrow key presses make: steps of the scale, from `cap` when it is full, and full past `cap`. */
export function limitWidthBy(current: Width, by: number, cap: number, scale: WidthScale): Width {
  const next = snapWidth(current === 'full' ? cap : current, scale) + by * scale.step
  return next > cap ? 'full' : snapWidth(next, scale)
}
