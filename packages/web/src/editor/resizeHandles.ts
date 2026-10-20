import {
  asAlign,
  asInt,
  asOneOf,
  asString,
  BANNER_HEIGHTS,
  CHART_HEIGHTS,
  clamp,
  columnEdgeFraction,
  COLUMN_GRID,
  formatColumnWidths,
  illustrationInfo,
  MAP_HEIGHTS,
  moveColumnEdge,
  parseColumnWidths,
  type InputValue,
  type Inputs,
} from '@feature-domain/engine'
import { rowBottoms, rowsAsCards, tableRows } from '../renderer/tableFit'
import {
  aspectHeights,
  IMAGE_WIDTH,
  imageWidthAt,
  imageWidthBy,
  nearestStep,
  PERCENT_WIDTH,
  percentWidthAt,
  percentWidthBy,
  scrollRowsAt,
  scrollRowsBy,
  scrollRowsEstimated,
  scrollRowsText,
  SCROLL_ROWS,
  sharesText,
  stepBy,
  stepText,
  trackFraction,
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
 * One handle on the selected feature: an edge that changes an input when dragged (`at`) or moved with the arrow keys
 * (`by`). Both measure the page when called, since it regenerates while the handle moves.
 */
export interface ResizeHandle {
  key: string
  /** What it sizes, for screen readers ("Height of Banner"). */
  name: string
  /** `y`: a bottom edge dragged up and down; `x`: a side edge dragged sideways. */
  axis: 'x' | 'y'
  edge: Edge
  /** The extent snap marks span across the axis (a bottom edge's marks run its width), in client coordinates. */
  across: { from: number; to: number }
  /** The value in words, shown beside the handle and read by screen readers ("Tall", "2 : 1", "320 px", "8 rows"). */
  text: string
  /** The value as a number in [min, max], for the slider role. */
  now: number
  min: number
  max: number
  at(x: number, y: number, fine: boolean): Record<string, InputValue>
  by(by: number, fine: boolean): Record<string, InputValue>
  /** Where a drag snaps to, drawn while dragging. */
  ticks(): Tick[]
}

const visible = (el: Element | null | undefined): el is HTMLElement => el instanceof HTMLElement && el.getBoundingClientRect().height > 0

const bottomEdge = (r: DOMRect): Pick<ResizeHandle, 'axis' | 'edge' | 'across'> => ({
  axis: 'y',
  edge: { x: r.left + r.width / 2, y: r.bottom, length: r.width },
  across: { from: r.left, to: r.right },
})

const sideEdge = (x: number, r: DOMRect): Pick<ResizeHandle, 'axis' | 'edge' | 'across'> => ({
  axis: 'x',
  edge: { x, y: r.top + r.height / 2, length: r.height },
  across: { from: r.top, to: r.bottom },
})

const STEPS = ['short', 'medium', 'tall'] as const

/** A handle that picks one of a few named heights (short, medium, tall) by the height dragged to. */
function heightSteps(
  name: string,
  input: string,
  measure: () => HTMLElement | null,
  heights: (width: number) => Record<(typeof STEPS)[number], number>,
  stored: InputValue | undefined,
): ResizeHandle | undefined {
  const el = measure()
  if (!visible(el)) return undefined
  const current = asOneOf(stored, STEPS, 'medium')
  const box = () => (measure() ?? el).getBoundingClientRect()
  return {
    key: input,
    name: `Height of ${name}`,
    ...bottomEdge(el.getBoundingClientRect()),
    text: stepText(current),
    now: STEPS.indexOf(current),
    min: 0,
    max: STEPS.length - 1,
    at(_x, y) {
      const r = box()
      return { [input]: nearestStep(heights(r.width), y - r.top, current) }
    },
    by: (by) => ({ [input]: stepBy(STEPS, current, by) }),
    ticks() {
      const r = box()
      const h = heights(r.width)
      return STEPS.map((step) => ({ at: r.top + h[step], label: stepText(step) }))
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
    ticks: () => [],
  }
}

/** A container's first-row cells, which give its columns. */
const firstRow = (grid: HTMLElement) => [...grid.children].filter((c): c is HTMLElement => c instanceof HTMLElement && /^r1c\d+$/.test(c.dataset.slot ?? ''))

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
    handles.push({
      key: `edge-${edge}`,
      name: `Edge between columns ${edge} and ${edge + 1} of ${name}`,
      ...sideEdge((rects[edge - 1]!.right + rects[edge]!.left) / 2, gridRect),
      text: sharesText(shares),
      now: Math.round(fraction * COLUMN_GRID),
      min: 1,
      max: COLUMN_GRID - 1,
      at(x) {
        const s = span()
        return change(trackFraction(x, s, s.gap, columns, edge))
      },
      by: (by) => change(fraction + by / COLUMN_GRID),
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
 * The handles a selected feature has, measured from its element on the canvas. Only inputs that already hold a size
 * get one: Image width (not for a responsive illustration, which fills the width) and banner height, Map and Chart
 * heights, a table's Scroll after, a Separator's width and a Container's column edges. `inputs` are the feature's
 * inputs with defaults filled in; `name` names the feature for screen readers.
 */
export function resizeHandles(container: HTMLElement, featureType: string, id: string, inputs: Inputs, name: string): ResizeHandle[] {
  const find = () => container.querySelector<HTMLElement>(`[data-feature-id="${CSS.escape(id)}"]`)
  const featureEl = find()
  if (!featureEl || featureEl.classList.contains('fd-placeholder')) return []
  const handles: (ResizeHandle | undefined)[] = []
  switch (featureType) {
    case 'ImageFeature': {
      const illustration = inputs.source === 'illustration'
      if (illustration && illustrationInfo(asString(inputs.illustration))?.kind === 'banner')
        handles.push(heightSteps(name, 'banner_height', find, (w) => aspectHeights(BANNER_HEIGHTS, w), inputs.banner_height))
      // A responsive illustration fills the width; a responsive link image still takes its Width (as a most).
      if (!(illustration && inputs.responsive === true)) handles.push(imageWidth(name, find, inputs))
      break
    }
    case 'GoogleMapFeature': {
      const drawing = () => container.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(`${id}.map`)}"]`)
      handles.push(heightSteps(name, 'height', drawing, (w) => aspectHeights(MAP_HEIGHTS, w), inputs.height))
      break
    }
    case 'GoogleChartFeature': {
      const plot = () => [...(find()?.querySelectorAll<HTMLElement>('.fd-chart-canvas, .fd-chart-skeleton') ?? [])].find(visible) ?? null
      handles.push(heightSteps(name, 'height', plot, () => ({ ...CHART_HEIGHTS }), inputs.height))
      break
    }
    case 'TableFeature':
      handles.push(tableRowsHandle(name, find, inputs))
      break
    case 'SeparatorFeature':
      handles.push(separatorWidth(name, find, inputs))
      break
    case 'ContainerFeature':
      handles.push(...columnEdges(name, find, inputs))
      break
  }
  return handles.filter((h): h is ResizeHandle => h !== undefined)
}
