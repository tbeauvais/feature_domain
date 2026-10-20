import {
  asAlign,
  asBool,
  asInt,
  asOneOf,
  asString,
  BANNER_HEIGHTS,
  CHART_HEIGHTS,
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
import {
  aspectHeights,
  IMAGE_WIDTH,
  imageWidthAt,
  imageWidthBy,
  nearestStep,
  scrollRowsAt,
  scrollRowsBy,
  scrollRowsText,
  SCROLL_ROWS,
  sharesText,
  stepBy,
  stepText,
  trackFraction,
} from './resize'

/** A point or a line on the page, in client (viewport) coordinates. */
export interface Edge {
  x: number
  y: number
  /** The edge's length along it (a bottom edge's width, a side edge's height). */
  length: number
}

/**
 * One handle on the selected feature: an edge that changes an input when dragged (`at`) or moved with the arrow keys
 * (`by`). Both measure the page when called, since it regenerates while the handle moves.
 */
export interface ResizeHandle {
  key: string
  /** What it sizes, for screen readers ("Height", "Width", "Edge between columns 1 and 2"). */
  name: string
  /** `y`: a bottom edge dragged up and down; `x`: a side edge dragged sideways. */
  axis: 'x' | 'y'
  edge: Edge
  /** The value in words, shown while dragging and read by screen readers ("Tall", "2 : 1", "320 px", "8 rows"). */
  text: string
  /** The value as a number in [min, max], for the slider role. */
  now: number
  min: number
  max: number
  at(x: number, y: number, fine: boolean): Record<string, InputValue>
  by(by: number, fine: boolean): Record<string, InputValue>
}

type Rect = DOMRect

const bottomEdge = (r: Rect): Edge => ({ x: r.left + r.width / 2, y: r.bottom, length: r.width })
const sideEdge = (x: number, r: Rect): Edge => ({ x, y: r.top + r.height / 2, length: r.height })
const visible = (el: Element | null): el is HTMLElement => el instanceof HTMLElement && el.getBoundingClientRect().height > 0

/** A handle that picks one of a few named heights (short, medium, tall) by the height dragged to. */
function heightSteps(
  key: string,
  input: string,
  measure: () => HTMLElement | null,
  heights: (width: number) => Record<string, number>,
  current: string,
): ResizeHandle | undefined {
  const el = measure()
  if (!visible(el)) return undefined
  const rect = el.getBoundingClientRect()
  const order = Object.keys(heights(rect.width))
  return {
    key,
    name: 'Height',
    axis: 'y',
    edge: bottomEdge(rect),
    text: stepText(current),
    now: Math.max(0, order.indexOf(current)),
    min: 0,
    max: order.length - 1,
    at(_x, y) {
      const r = (measure() ?? el).getBoundingClientRect()
      return { [input]: nearestStep(heights(r.width), y - r.top) }
    },
    by: (by) => ({ [input]: stepBy(order, current, by) }),
  }
}

/** The room an element has in its parent (the parent's content width). */
function room(el: HTMLElement): number {
  const parent = el.parentElement
  if (!parent) return el.getBoundingClientRect().width
  const style = getComputedStyle(parent)
  return parent.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)
}

function imageWidth(featureEl: HTMLElement, find: () => HTMLElement | null, inputs: Inputs): ResizeHandle | undefined {
  if (asBool(inputs.responsive) || !visible(featureEl)) return undefined
  const align = asAlign(inputs.align, 'center')
  const rect = featureEl.getBoundingClientRect()
  const max = Math.max(IMAGE_WIDTH.min, Math.floor(room(featureEl)))
  const width = Math.round(rect.width)
  return {
    key: 'width',
    name: 'Width',
    axis: 'x',
    edge: sideEdge(align === 'right' ? rect.left : rect.right, rect),
    text: `${width} px`,
    now: width,
    min: IMAGE_WIDTH.min,
    max,
    at(x, _y, fine) {
      const el = find() ?? featureEl
      return { width: String(imageWidthAt(align, el.getBoundingClientRect(), x, room(el), fine)) }
    },
    by: (by, fine) => ({ width: String(imageWidthBy(width, by, max, fine)) }),
  }
}

function columnEdges(grid: HTMLElement, find: () => HTMLElement | null, inputs: Inputs): ResizeHandle[] {
  const cells = [...grid.children].filter((c): c is HTMLElement => c instanceof HTMLElement && /^r1c\d+$/.test(c.dataset.slot ?? ''))
  const columns = cells.length
  if (columns < 2) return []
  const rects = cells.map((c) => c.getBoundingClientRect())
  // Stacked at phone width: no edges to drag.
  if (rects[1]!.left <= rects[0]!.left) return []
  const parsed = parseColumnWidths(inputs.column_widths, columns)
  const shares = Array.isArray(parsed) ? parsed : Array<number>(columns).fill(1)
  const gridRect = grid.getBoundingClientRect()
  const handles: ResizeHandle[] = []
  for (let edge = 1; edge < columns; edge++) {
    const gap = rects[edge]!.left - rects[edge - 1]!.right
    const fraction = columnEdgeFraction(shares, edge)
    const change = (to: number) => ({ column_widths: formatColumnWidths(moveColumnEdge(shares, edge, to)) })
    handles.push({
      key: `edge-${edge}`,
      name: `Edge between columns ${edge} and ${edge + 1}`,
      axis: 'x',
      edge: sideEdge((rects[edge - 1]!.right + rects[edge]!.left) / 2, gridRect),
      text: sharesText(shares),
      now: Math.round(fraction * COLUMN_GRID),
      min: 1,
      max: COLUMN_GRID - 1,
      at(x) {
        const r = (find() ?? grid).getBoundingClientRect()
        return change(trackFraction(x, r, gap, columns, edge))
      },
      by: (by) => change(fraction + by / COLUMN_GRID),
    })
  }
  return handles
}

function tableRows(featureEl: HTMLElement, find: () => HTMLElement | null, inputs: Inputs): ResizeHandle | undefined {
  const wrap = featureEl.querySelector<HTMLElement>('.fd-table-wrap')
  const table = wrap?.querySelector('table')
  if (!wrap || !table || !visible(wrap)) return undefined
  const rowCount = wrap.querySelectorAll('tbody:not(.fd-table-skeleton) > tr').length
  // No rows yet, or rows shown as cards (phone width), which never scroll inside the page.
  if (rowCount === 0 || getComputedStyle(table).display === 'block') return undefined
  const current = Math.max(0, asInt(inputs.scroll_rows, 0))
  const rowHeight = () => 2.75 * (parseFloat(getComputedStyle(find()?.querySelector('.fd-table-wrap') ?? wrap).fontSize) || 16)
  return {
    key: 'scroll-rows',
    name: 'Rows before scrolling',
    axis: 'y',
    edge: bottomEdge(wrap.getBoundingClientRect()),
    text: scrollRowsText(current),
    // Every row (0) is one past the most rows a table can scroll after.
    now: current === 0 ? SCROLL_ROWS.max + 1 : current,
    min: SCROLL_ROWS.min,
    max: SCROLL_ROWS.max + 1,
    at(_x, y) {
      const box = find()?.querySelector('.fd-table-wrap') ?? wrap
      return { scroll_rows: scrollRowsAt(y - box.getBoundingClientRect().top, rowHeight(), rowCount, box.scrollHeight) }
    },
    by: (by) => ({ scroll_rows: scrollRowsBy(current, by, rowCount) }),
  }
}

/**
 * The handles a selected feature has, measured from its element on the canvas. Only inputs that already hold a size
 * get one: Image width (not responsive) and banner height, Map and Chart heights, a table's Scroll after and a
 * Container's column edges. `inputs` are the feature's inputs with defaults filled in.
 */
export function resizeHandles(container: HTMLElement, featureType: string, id: string, inputs: Inputs): ResizeHandle[] {
  const find = () => container.querySelector<HTMLElement>(`[data-feature-id="${CSS.escape(id)}"]`)
  const featureEl = find()
  if (!featureEl || featureEl.classList.contains('fd-placeholder')) return []
  const handles: (ResizeHandle | undefined)[] = []
  switch (featureType) {
    case 'ImageFeature':
      if (inputs.source === 'illustration' && illustrationInfo(asString(inputs.illustration))?.kind === 'banner')
        handles.push(
          heightSteps(
            'height',
            'banner_height',
            find,
            (w) => aspectHeights(BANNER_HEIGHTS, w),
            asOneOf(inputs.banner_height, ['short', 'medium', 'tall'], 'medium'),
          ),
        )
      handles.push(imageWidth(featureEl, find, inputs))
      break
    case 'GoogleMapFeature': {
      const drawing = () => container.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(`${id}.map`)}"]`)
      handles.push(
        heightSteps('height', 'height', drawing, (w) => aspectHeights(MAP_HEIGHTS, w), asOneOf(inputs.height, ['short', 'medium', 'tall'], 'medium')),
      )
      break
    }
    case 'GoogleChartFeature': {
      const plot = () => [...(find()?.querySelectorAll<HTMLElement>('.fd-chart-canvas, .fd-chart-skeleton') ?? [])].find(visible) ?? null
      handles.push(heightSteps('height', 'height', plot, () => ({ ...CHART_HEIGHTS }), asOneOf(inputs.height, ['short', 'medium', 'tall'], 'medium')))
      break
    }
    case 'TableFeature':
      handles.push(tableRows(featureEl, find, inputs))
      break
    case 'ContainerFeature':
      handles.push(...columnEdges(featureEl, find, inputs))
      break
  }
  return handles.filter((h): h is ResizeHandle => h !== undefined)
}
