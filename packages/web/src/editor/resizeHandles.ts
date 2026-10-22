import {
  asAlign,
  asInt,
  asString,
  BANNER_HEIGHT_SCALE,
  CHART_HEIGHT_SCALE,
  clamp,
  columnEdgeFraction,
  COLUMN_GRID,
  CONTENT_WIDTH_PRESETS,
  CONTENT_WIDTH_SCALE,
  DEFAULT_CONTENT_WIDTH,
  formatColumnWidths,
  formatHeight,
  formatWidth,
  heightText,
  illustrationInfo,
  MAP_HEIGHT_SCALE,
  MAX_COLUMN_SHARE,
  MAX_WIDTH_SCALE,
  MIN_HEIGHT_SCALE,
  moveColumnEdge,
  parseColumnWidths,
  readHeight,
  readPixels,
  readWidth,
  reduceShares,
  snapWidth,
  widthText,
  type Height,
  type HeightScale,
  type InputValue,
  type Inputs,
  type Width,
} from '@feature-domain/engine'
import { rowBottoms, rowsAsCards, tableRows } from '../renderer/tableFit'
import {
  heightAt,
  heightBy,
  heightPx,
  IMAGE_WIDTH,
  imageWidthAt,
  imageWidthBy,
  limitWidthAt,
  limitWidthBy,
  PERCENT_WIDTH,
  percentWidthAt,
  percentWidthBy,
  scrollRowsAt,
  scrollRowsBy,
  scrollRowsEstimated,
  scrollRowsText,
  SCROLL_ROWS,
  sharesText,
  trackFraction,
  widthAt,
} from './resize'

/** An edge on the page, in client (viewport) coordinates: its middle and its length along it. */
export interface Edge {
  x: number
  y: number
  length: number
}

/** A place a drag snaps to, drawn while dragging: a position along the handle's axis (client coordinates). */
export interface Tick {
  at: number
  label?: string
}

/**
 * Where a size is drawn as a dimension, in client coordinates: a line along the handle's axis from `from` to `to`,
 * placed at `at` across it (beside the feature), with the value's pill at `pill` along it.
 */
export interface DimensionLine {
  from: number
  to: number
  at: number
  pill: number
}

/**
 * One size of a feature: an edge that changes an input when dragged (`at`), moved with the arrow keys (`by`) or typed
 * (`parse`), drawn as a dimension. All measure the page when called, since it regenerates while the size changes.
 */
export interface ResizeHandle {
  key: string
  /** What it sizes, for screen readers ("Height of Banner"). */
  name: string
  /** The size's name on its dimension ("Height"); empty for column shares, which speak for themselves. */
  label: string
  /** `y`: a bottom edge dragged up and down; `x`: a side edge dragged sideways. */
  axis: 'x' | 'y'
  edge: Edge
  /** The extent snap marks span across the axis (a bottom edge's marks run its width), in client coordinates. */
  across: { from: number; to: number }
  dimension: DimensionLine
  /** The value in words, on the dimension and read by screen readers ("Tall", "2 : 1", "320 px", "8 rows"). */
  text: string
  /** Where the value comes from or what it shows here, when that isn't plain ("theme Harbor", "shows 676 px here"). */
  note?: string
  /** The value as a number in [min, max], for the slider role. */
  now: number
  min: number
  max: number
  /** The feature whose inputs it changes, when that isn't the measured one (a page's width set on its theme). */
  feature?: string
  at(x: number, y: number, fine: boolean): Record<string, InputValue>
  by(by: number, fine: boolean): Record<string, InputValue>
  /** A typed value (as `text` shows it, or plainer), or undefined when it can't be read. */
  parse(text: string): Record<string, InputValue> | undefined
  /** What typing accepts, for the field's hint ("Short, medium, tall or a %"). */
  accepts: string
  /** Where a drag snaps to, drawn while dragging. */
  ticks(): Tick[]
}

/** A size the feature has but no input sets (it follows something else), drawn as a reference dimension. */
export interface ReferenceDimension {
  key: string
  axis: 'x' | 'y'
  dimension: DimensionLine
  text: string
  /** What sets it, or how to make it settable, in a few words. */
  why: string
}

/** Another feature's type, inputs (defaults filled in) and name, for sizes set elsewhere (a page's theme). */
export type FeatureLookup = (id: string) => { feature: string; inputs: Inputs; name: string } | undefined

/** How far outside a feature its dimensions are drawn. */
const OFFSET = 18

const visible = (el: Element | null | undefined): el is HTMLElement => el instanceof HTMLElement && el.getBoundingClientRect().height > 0

const bottomEdge = (r: DOMRect): Pick<ResizeHandle, 'axis' | 'edge' | 'across' | 'dimension'> => ({
  axis: 'y',
  edge: { x: r.left + r.width / 2, y: r.bottom, length: r.width },
  across: { from: r.left, to: r.right },
  dimension: { from: r.top, to: r.bottom, at: r.right + OFFSET, pill: r.top + r.height / 2 },
})

const sideEdge = (x: number, r: DOMRect, above = true): Pick<ResizeHandle, 'axis' | 'edge' | 'across' | 'dimension'> => ({
  axis: 'x',
  edge: { x, y: r.top + r.height / 2, length: r.height },
  across: { from: r.top, to: r.bottom },
  dimension: { from: r.left, to: r.right, at: above ? r.top - OFFSET : r.bottom + OFFSET, pill: r.left + r.width / 2 },
})

/** Whole numbers typed with or without a unit ("320", "320 px", "8 rows"). */
const typedNumber = (text: string, unit = '') => {
  const match = new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*(?:${unit})?$`, 'i').exec(text.trim())
  return match ? Number(match[1]) : undefined
}

/**
 * A height by name or number (a % of the width, or pixels): a drag sticks to the named heights and moves in steps of
 * the scale between them; Shift with the arrow keys goes to the next named height.
 */
function scaledHeight(
  name: string,
  input: string,
  measure: () => HTMLElement | null,
  scale: HeightScale,
  stored: InputValue | undefined,
): ResizeHandle | undefined {
  const el = measure()
  if (!visible(el)) return undefined
  const current: Height = readHeight(stored, scale) ?? { value: scale.named.medium, name: 'medium' }
  const box = () => (measure() ?? el).getBoundingClientRect()
  const set = (height: Height) => ({ [input]: formatHeight(height, scale) })
  return {
    key: input,
    name: `Height of ${name}`,
    label: 'Height',
    ...bottomEdge(el.getBoundingClientRect()),
    text: heightText(current, scale),
    now: current.value,
    min: scale.min,
    max: scale.max,
    at(_x, y) {
      const r = box()
      return set(heightAt(y - r.top, r.width, scale, current))
    },
    by: (by, fine) => set(heightBy(current, by, scale, fine)),
    parse(text) {
      const height = readHeight(text.replace(/\s+/g, ''), scale)
      return height ? set(height) : undefined
    },
    accepts:
      scale.unit === '%'
        ? `Short, medium, tall, or a % of the width (${scale.min} to ${scale.max})`
        : `Short, medium, tall, or pixels (${scale.min} to ${scale.max})`,
    ticks() {
      const r = box()
      return (['short', 'medium', 'tall'] as const).map((step) => ({
        at: r.top + heightPx({ value: scale.named[step] }, scale, r.width),
        label: step[0]!.toUpperCase() + step.slice(1),
      }))
    },
  }
}

/** The room an element has in its parent (the parent's content width). */
function room(el: HTMLElement): number {
  const parent = el.parentElement
  if (!parent) return el.getBoundingClientRect().width
  const style = getComputedStyle(parent)
  return parent.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)
}

function imageWidth(name: string, find: () => HTMLElement | null, inputs: Inputs): ResizeHandle | undefined {
  const el = find()
  if (!visible(el)) return undefined
  const align = asAlign(inputs.align, 'center')
  const rect = el.getBoundingClientRect()
  const max = Math.max(IMAGE_WIDTH.min, Math.floor(room(el)))
  const width = Math.round(rect.width)
  return {
    key: 'width',
    name: `Width of ${name}`,
    label: 'Width',
    ...sideEdge(align === 'right' ? rect.left : rect.right, rect),
    text: `${width} px`,
    now: clamp(width, IMAGE_WIDTH.min, max),
    min: IMAGE_WIDTH.min,
    max,
    at(x, _y, fine) {
      const now = find() ?? el
      return { width: String(imageWidthAt(align, now.getBoundingClientRect(), x, room(now), fine)) }
    },
    by: (by, fine) => ({ width: String(imageWidthBy(width, by, max, fine)) }),
    parse(text) {
      const px = typedNumber(text, 'px')
      return px === undefined ? undefined : { width: String(clamp(Math.round(px), IMAGE_WIDTH.min, max)) }
    },
    accepts: `Pixels (${IMAGE_WIDTH.min} to ${max})`,
    ticks: () => [],
  }
}

function separatorWidth(name: string, find: () => HTMLElement | null, inputs: Inputs): ResizeHandle | undefined {
  const el = find()
  if (!el) return undefined
  const rect = el.getBoundingClientRect()
  if (rect.width === 0) return undefined
  const align = asAlign(inputs.align, 'center')
  const percent = clamp(asInt(inputs.width, 100), PERCENT_WIDTH.min, PERCENT_WIDTH.max)
  return {
    key: 'width',
    name: `Width of ${name}`,
    label: 'Width',
    ...sideEdge(align === 'right' ? rect.left : rect.right, rect),
    text: `${percent}%`,
    now: percent,
    min: PERCENT_WIDTH.min,
    max: PERCENT_WIDTH.max,
    at(x, _y, fine) {
      const now = find() ?? el
      return { width: percentWidthAt(align, now.getBoundingClientRect(), x, room(now), fine) }
    },
    by: (by, fine) => ({ width: percentWidthBy(percent, by, fine) }),
    parse(text) {
      const value = typedNumber(text, '%')
      return value === undefined ? undefined : { width: clamp(Math.round(value), PERCENT_WIDTH.min, PERCENT_WIDTH.max) }
    },
    accepts: `A % of the room (${PERCENT_WIDTH.min} to ${PERCENT_WIDTH.max})`,
    ticks: () => [],
  }
}

/** A container's first-row cells, which give its columns. */
const firstRow = (grid: HTMLElement) => [...grid.children].filter((c): c is HTMLElement => c instanceof HTMLElement && /^r1c\d+$/.test(c.dataset.slot ?? ''))

/** Typed column widths for this many columns: "2 : 1" or "2, 1", every column given. */
function typedShares(text: string, columns: number): number[] | undefined {
  const parts = text.split(/[:,]/).map((p) => p.trim())
  if (parts.length !== columns || !parts.every((p) => /^\d+$/.test(p) && Number(p) >= 1 && Number(p) <= MAX_COLUMN_SHARE)) return undefined
  return reduceShares(parts.map(Number))
}

function columnEdges(name: string, find: () => HTMLElement | null, inputs: Inputs): ResizeHandle[] {
  const grid = find()
  if (!grid) return []
  const rects = firstRow(grid).map((c) => c.getBoundingClientRect())
  const columns = rects.length
  if (columns < 2) return []
  // Stacked at phone width: no edges to drag.
  if (rects[1]!.left <= rects[0]!.left) return []
  const parsed = parseColumnWidths(inputs.column_widths, columns)
  const shares = Array.isArray(parsed) ? parsed : Array<number>(columns).fill(1)
  const gridRect = grid.getBoundingClientRect()
  // The columns run from the first cell's left edge to the last one's right edge: the well's padding is no column.
  const span = () => {
    const now = firstRow(find() ?? grid).map((c) => c.getBoundingClientRect())
    const cells = now.length === columns ? now : rects
    return { left: cells[0]!.left, width: cells[columns - 1]!.right - cells[0]!.left, gap: cells[1]!.left - cells[0]!.right }
  }
  const handles: ResizeHandle[] = []
  for (let edge = 1; edge < columns; edge++) {
    const fraction = columnEdgeFraction(shares, edge)
    const change = (to: number) => ({ column_widths: formatColumnWidths(moveColumnEdge(shares, edge, to)) })
    const x = (rects[edge - 1]!.right + rects[edge]!.left) / 2
    handles.push({
      key: `edge-${edge}`,
      name: `Edge between columns ${edge} and ${edge + 1} of ${name}`,
      label: '',
      ...sideEdge(x, gridRect),
      // The two columns the edge sits between, with their shares at the edge.
      dimension: { from: rects[edge - 1]!.left, to: rects[edge]!.right, at: gridRect.top - OFFSET, pill: x },
      text: sharesText(shares),
      now: Math.round(fraction * COLUMN_GRID),
      min: 1,
      max: COLUMN_GRID - 1,
      at(px) {
        const s = span()
        return change(trackFraction(px, s, s.gap, columns, edge))
      },
      by: (by) => change(fraction + by / COLUMN_GRID),
      parse(text) {
        const typed = typedShares(text, columns)
        return typed ? { column_widths: formatColumnWidths(typed) } : undefined
      },
      accepts: `Shares of the row for all ${columns} columns, e.g. ${Array.from({ length: columns }, (_, i) => (i === 0 ? 2 : 1)).join(' : ')}`,
      ticks() {
        const s = span()
        const tracks = s.width - s.gap * (columns - 1)
        const start = s.left + s.gap * (edge - 1) + s.gap / 2
        return Array.from({ length: COLUMN_GRID - 1 }, (_, i) => ({ at: start + ((i + 1) / COLUMN_GRID) * tracks }))
      },
    })
  }
  return handles
}

/** A Container's Max width: its outer edge, from a narrow card to filling the page (no max width). */
function maxWidth(name: string, find: () => HTMLElement | null, inputs: Inputs): ResizeHandle | undefined {
  const grid = find()
  if (!visible(grid)) return undefined
  const rect = grid.getBoundingClientRect()
  const stored = asString(inputs.max_width).trim() === '' ? 'full' : readWidth(inputs.max_width, MAX_WIDTH_SCALE)
  const current: Width = stored ?? 'full'
  const align = current === 'full' ? 'center' : asAlign(inputs.align, 'center')
  const cap = Math.max(MAX_WIDTH_SCALE.min, Math.floor(room(grid)))
  const set = (width: Width) => ({ max_width: width === 'full' ? '' : formatWidth(width) })
  return {
    key: 'max-width',
    name: `Max width of ${name}`,
    label: 'Max width',
    ...sideEdge(align === 'right' ? rect.left : rect.right, rect, false),
    text: current === 'full' ? 'Fills' : widthText(current),
    note: current !== 'full' && current > rect.width + 1 ? `${Math.round(rect.width)} px here` : undefined,
    now: Math.round(rect.width),
    min: MAX_WIDTH_SCALE.min,
    max: cap,
    at(x) {
      const now = (find() ?? grid).getBoundingClientRect()
      return set(limitWidthAt(widthAt(align, now, x), room(find() ?? grid), MAX_WIDTH_SCALE))
    },
    by: (by) => set(limitWidthBy(current === 'full' ? 'full' : Math.min(current, cap), by, cap, MAX_WIDTH_SCALE)),
    parse(text) {
      const t = text.trim().toLowerCase()
      if (t === '' || t === 'fills' || t === 'fill' || t === 'none' || t === 'full') return set('full')
      const px = typedNumber(t, 'px')
      return px === undefined ? undefined : set(readWidth(String(Math.round(px)), MAX_WIDTH_SCALE)!)
    },
    accepts: `Pixels (${MAX_WIDTH_SCALE.min} to ${MAX_WIDTH_SCALE.max}), or fills`,
    ticks: () => [],
  }
}

/**
 * How tall an element is without its min height: what its content needs. The min height is lifted for the reading
 * only (one synchronous layout, put back before anything paints).
 */
function naturalHeight(el: HTMLElement): number {
  const before = el.style.minHeight
  el.style.minHeight = '0px'
  const height = el.getBoundingClientRect().height
  el.style.minHeight = before
  return height
}

/**
 * A Container's Min height: its bottom edge, dragged below what its content needs (above it, it fits the content
 * again). It still grows past the min height when its content needs more.
 */
function minHeight(name: string, find: () => HTMLElement | null, inputs: Inputs): ResizeHandle | undefined {
  const grid = find()
  if (!visible(grid)) return undefined
  const rect = grid.getBoundingClientRect()
  const natural = naturalHeight(grid)
  const stored = asString(inputs.min_height).trim() === '' ? undefined : readPixels(inputs.min_height, MIN_HEIGHT_SCALE)
  const fits = (px: number) => px <= natural + MIN_HEIGHT_SCALE.step / 2
  const set = (px: number | undefined) => ({ min_height: px === undefined || fits(px) ? '' : String(snapWidth(px, MIN_HEIGHT_SCALE)) })
  const shown = Math.round(rect.height)
  return {
    key: 'min-height',
    name: `Min height of ${name}`,
    label: 'Min height',
    ...bottomEdge(rect),
    text: stored === undefined ? 'Fits content' : `${stored} px`,
    // A min height its content outgrows does nothing until the content shrinks.
    note: stored !== undefined && natural > stored + 1 ? `content ${Math.round(natural)} px` : undefined,
    now: stored ?? shown,
    min: MIN_HEIGHT_SCALE.min,
    max: MIN_HEIGHT_SCALE.max,
    at(_x, y) {
      const now = find() ?? grid
      return set(y - now.getBoundingClientRect().top)
    },
    by: (by) => set(Math.max(stored ?? 0, Math.ceil(natural / MIN_HEIGHT_SCALE.step) * MIN_HEIGHT_SCALE.step) + by * MIN_HEIGHT_SCALE.step),
    parse(text) {
      const t = text.trim().toLowerCase()
      if (t === '' || t === 'fits' || t === 'fit' || t === 'fits content' || t === 'none' || t === 'auto') return { min_height: '' }
      const px = typedNumber(t, 'px')
      return px === undefined ? undefined : { min_height: String(readPixels(String(Math.round(px)), MIN_HEIGHT_SCALE)) }
    },
    accepts: `Pixels (${MIN_HEIGHT_SCALE.min} to ${MIN_HEIGHT_SCALE.max}), or fits`,
    ticks: () => [{ at: (find() ?? grid).getBoundingClientRect().top + natural, label: 'Fits content' }],
  }
}

/** The side padding a page has when its content fills it (document.css: clamp(16px, 4cqi, 5 × the theme's space)). */
function leastPadding(page: HTMLElement): number {
  const space = parseFloat(getComputedStyle(page).getPropertyValue('--fd-space')) || 8
  const document = page.closest<HTMLElement>('.fd-root') ?? page
  return clamp((4 * document.getBoundingClientRect().width) / 100, 16, space * 5)
}

/**
 * A page's content width: its own when it has one, else its theme's (set on the Theme, so every page sharing it
 * follows), else the default theme's (then the page gets its own). Wider settings than this canvas shows are kept
 * unless the drag goes narrower.
 */
function contentWidth(id: string, name: string, find: () => HTMLElement | null, inputs: Inputs, lookup?: FeatureLookup): ResizeHandle | undefined {
  const page = find()
  if (!visible(page)) return undefined
  const content = () => {
    const el = find() ?? page
    const r = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    const left = r.left + (parseFloat(style.paddingLeft) || 0)
    const right = r.right - (parseFloat(style.paddingRight) || 0)
    return { left, width: right - left, room: r.width - 2 * leastPadding(el), bottom: r.bottom, padBottom: parseFloat(style.paddingBottom) || 0 }
  }
  const c = content()
  const own = asString(inputs.content_width).trim() !== ''
  const themeId = asString(inputs.theme)
  const theme = themeId !== '' ? lookup?.(themeId) : undefined
  const onTheme = !own && theme?.feature === 'ThemeFeature'
  const source = onTheme ? theme.inputs.content_width : own ? inputs.content_width : undefined
  const current: Width = readWidth(source, CONTENT_WIDTH_SCALE) ?? DEFAULT_CONTENT_WIDTH
  const set = (width: Width) => ({ content_width: formatWidth(width) })
  const shown = Math.round(c.width)
  const clipped = current === 'full' ? shown < Math.round(c.room) - 1 : current > shown + 1
  const where = onTheme ? `theme ${theme.name}` : own ? 'this page' : 'default theme'
  const rect = page.getBoundingClientRect()
  // In the page's bottom margin, clear of the dimensions of the features at its top.
  const line = c.bottom - Math.max(OFFSET, c.padBottom / 2)
  return {
    key: 'content-width',
    name: `Content width of ${name}`,
    label: 'Content width',
    axis: 'x',
    // A short grip at the content's edge beside the dimension, not the whole page's height (which features sit beside).
    edge: { x: c.left + c.width, y: line, length: 48 },
    across: { from: rect.top, to: rect.bottom },
    dimension: { from: c.left, to: c.left + c.width, at: line, pill: c.left + c.width / 2 },
    text: widthText(current),
    note: clipped && current !== 'full' ? `${where} · ${shown} px here` : where,
    now: current === 'full' ? CONTENT_WIDTH_SCALE.max : current,
    min: CONTENT_WIDTH_SCALE.min,
    max: CONTENT_WIDTH_SCALE.max,
    feature: onTheme ? themeId : id,
    at(x) {
      const now = content()
      return set(limitWidthAt(widthAt('center', now, x), now.room, CONTENT_WIDTH_SCALE, current))
    },
    by: (by) => set(limitWidthBy(current, by, CONTENT_WIDTH_SCALE.max, CONTENT_WIDTH_SCALE)),
    parse(text) {
      const t = text.trim().toLowerCase()
      const preset = CONTENT_WIDTH_PRESETS.find((p) => p.name.toLowerCase() === t)
      if (preset) return set(preset.width)
      const width = readWidth(t.replace(/\s+/g, ''), CONTENT_WIDTH_SCALE)
      return width === undefined ? undefined : set(width)
    },
    accepts: `Pixels (${CONTENT_WIDTH_SCALE.min} to ${CONTENT_WIDTH_SCALE.max}), ${CONTENT_WIDTH_PRESETS.map((p) => p.name.toLowerCase()).join(', ')}`,
    ticks: () => [],
  }
}

function tableRowsHandle(name: string, find: () => HTMLElement | null, inputs: Inputs): ResizeHandle | undefined {
  const parts = () => {
    const wrap = find()?.querySelector<HTMLElement>('.fd-table-wrap') ?? null
    return { wrap, table: wrap?.querySelector('table') ?? null }
  }
  const { wrap, table } = parts()
  if (!visible(wrap) || !table || rowsAsCards(table)) return undefined
  const rowCount = tableRows(table).length
  // A table of one or two rows always shows them all: nothing to choose.
  if (rowCount > 0 && rowCount < SCROLL_ROWS.min) return undefined
  const current = Math.max(0, asInt(inputs.scroll_rows, 0))
  // Until rows arrive (loading, failed or empty), the box is sized by document.css's estimate of a row's height.
  const estimate = () => 2.75 * (parseFloat(getComputedStyle(parts().wrap ?? wrap).fontSize) || 16)
  return {
    key: 'scroll-rows',
    name: `Rows before ${name} scrolls`,
    label: 'Scroll after',
    ...bottomEdge(wrap.getBoundingClientRect()),
    text: scrollRowsText(current),
    // Every row (0) is one past the most rows a table can scroll after.
    now: current === 0 ? SCROLL_ROWS.max + 1 : current,
    min: SCROLL_ROWS.min,
    max: SCROLL_ROWS.max + 1,
    at(_x, y) {
      const now = parts()
      const height = y - (now.wrap ?? wrap).getBoundingClientRect().top
      const bottoms = rowBottoms(now.table ?? table)
      return { scroll_rows: bottoms.length > 0 ? scrollRowsAt(height, bottoms, current) : scrollRowsEstimated(height, estimate()) }
    },
    by: (by) => ({ scroll_rows: scrollRowsBy(current, by, rowCount > 0 ? rowCount : Infinity) }),
    parse(text) {
      const t = text.trim().toLowerCase()
      if (t === 'all' || t === 'all rows') return { scroll_rows: 0 }
      const rows = typedNumber(t, 'rows?')
      if (rows === undefined || !Number.isInteger(rows)) return undefined
      return { scroll_rows: rows > SCROLL_ROWS.max ? 0 : Math.max(SCROLL_ROWS.min, rows) }
    },
    accepts: `Rows (${SCROLL_ROWS.min} or more), or all`,
    ticks() {
      const now = parts()
      const top = (now.wrap ?? wrap).getBoundingClientRect().top
      return rowBottoms(now.table ?? table)
        .slice(SCROLL_ROWS.min - 1, SCROLL_ROWS.max)
        .map((bottom) => ({ at: top + bottom }))
    },
  }
}

/**
 * The sizes a feature has, measured from its element on the canvas. Only inputs that hold a size get one: Image width
 * (not for a responsive illustration, which fills the width) and banner height, Map and Chart heights, a table's
 * Scroll after, a Separator's width, a Container's column edges, Max width and Min height, and a Page's content width (on its
 * theme unless it has its own). `inputs` are the feature's inputs with defaults filled in; `name` names the feature for
 * screen readers; `lookup` reads other features (a page's theme).
 */
export function resizeHandles(container: HTMLElement, featureType: string, id: string, inputs: Inputs, name: string, lookup?: FeatureLookup): ResizeHandle[] {
  const find = () => container.querySelector<HTMLElement>(`[data-feature-id="${CSS.escape(id)}"]`)
  const featureEl = find()
  if (!featureEl || featureEl.classList.contains('fd-placeholder')) return []
  const handles: (ResizeHandle | undefined)[] = []
  switch (featureType) {
    case 'ImageFeature': {
      const illustration = inputs.source === 'illustration'
      if (illustration && illustrationInfo(asString(inputs.illustration))?.kind === 'banner')
        handles.push(scaledHeight(name, 'banner_height', find, BANNER_HEIGHT_SCALE, inputs.banner_height))
      // A responsive illustration fills the width; a responsive link image still takes its Width (as a most).
      if (!(illustration && inputs.responsive === true)) handles.push(imageWidth(name, find, inputs))
      break
    }
    case 'GoogleMapFeature': {
      const drawing = () => container.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(`${id}.map`)}"]`)
      handles.push(scaledHeight(name, 'height', drawing, MAP_HEIGHT_SCALE, inputs.height))
      break
    }
    case 'GoogleChartFeature': {
      const plot = () => [...(find()?.querySelectorAll<HTMLElement>('.fd-chart-canvas, .fd-chart-skeleton') ?? [])].find(visible) ?? null
      handles.push(scaledHeight(name, 'height', plot, CHART_HEIGHT_SCALE, inputs.height))
      break
    }
    case 'TableFeature':
      handles.push(tableRowsHandle(name, find, inputs))
      break
    case 'SeparatorFeature':
      handles.push(separatorWidth(name, find, inputs))
      break
    case 'ContainerFeature':
      handles.push(...columnEdges(name, find, inputs), maxWidth(name, find, inputs), minHeight(name, find, inputs))
      break
    case 'PageFeature':
      handles.push(contentWidth(id, name, find, inputs, lookup))
      break
  }
  return handles.filter((h): h is ResizeHandle => h !== undefined)
}

/**
 * Sizes a feature has that no input sets, drawn as reference dimensions so it is clear why they have no handle: a
 * responsive illustration's width (it fills its column) and a Header's height (its text and the theme set it).
 */
export function referenceDimensions(container: HTMLElement, featureType: string, id: string, inputs: Inputs): ReferenceDimension[] {
  const el = container.querySelector<HTMLElement>(`[data-feature-id="${CSS.escape(id)}"]`)
  if (!visible(el) || el.classList.contains('fd-placeholder')) return []
  const r = el.getBoundingClientRect()
  if (featureType === 'ImageFeature' && inputs.source === 'illustration' && inputs.responsive === true)
    return [
      {
        key: 'width',
        axis: 'x',
        dimension: { from: r.left, to: r.right, at: r.top - OFFSET, pill: r.left + r.width / 2 },
        text: 'Width · fills the column',
        why: 'Turn off Responsive to set a width',
      },
    ]
  if (featureType === 'HeaderFeature')
    return [
      {
        key: 'height',
        axis: 'y',
        dimension: { from: r.top, to: r.bottom, at: r.right + OFFSET, pill: r.top + r.height / 2 },
        text: 'Height · follows the text',
        why: "Set by its text and the theme's type scale",
      },
    ]
  return []
}
