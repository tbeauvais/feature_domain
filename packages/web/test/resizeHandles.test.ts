import { afterEach, describe, expect, it, vi } from 'vitest'
import { canonicalWidths, columnPresets } from '../src/editor/columnPresets'
import { resizeHandles } from '../src/editor/resizeHandles'
import { scrollFit } from '../src/renderer/tableFit'

// The handles measure the page, so these tests lay out a small page by hand: jsdom has no layout, so each element's
// box is given (`box`) and computed styles come from `styles`.

interface Box {
  left: number
  top: number
  width: number
  height: number
}

function box(el: Element, b: Box) {
  const rect = { ...b, x: b.left, y: b.top, right: b.left + b.width, bottom: b.top + b.height, toJSON: () => ({}) }
  el.getBoundingClientRect = () => rect as DOMRect
  return el
}

const styles = new Map<Element, Partial<CSSStyleDeclaration>>()
const realStyle = window.getComputedStyle.bind(window)
vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
  const own = styles.get(el)
  return (own ? { ...realStyle(el), ...own } : realStyle(el)) as CSSStyleDeclaration
})

afterEach(() => {
  document.body.innerHTML = ''
  styles.clear()
})

function page(html: string) {
  const container = document.createElement('div')
  container.innerHTML = html
  document.body.append(container)
  return container
}

const handle = (container: HTMLElement, type: string, inputs: Record<string, unknown>, key: string) =>
  resizeHandles(container, type, '2', inputs as never, 'Thing').find((h) => h.key === key)

describe('image handles', () => {
  function image(align: string) {
    const container = page(`<div id="cell"><img data-feature-id="2" /></div>`)
    box(container.querySelector('#cell')!, { left: 0, top: 0, width: 600, height: 300 })
    Object.defineProperty(container.querySelector('#cell')!, 'clientWidth', { value: 600 })
    box(container.querySelector('img')!, { left: align === 'right' ? 300 : 0, top: 0, width: 300, height: 200 })
    return container
  }

  it('sizes a fixed-width image from its right edge, named for the feature', () => {
    const width = handle(image('left'), 'ImageFeature', { source: 'link', responsive: false, align: 'left' }, 'width')!
    expect(width).toMatchObject({ name: 'Width of Thing', axis: 'x', text: '300 px', now: 300, max: 600, edge: { x: 300 } })
    expect(width.at(424, 0, false)).toEqual({ width: '420' })
    expect(width.at(424, 0, true)).toEqual({ width: '424' })
    expect(width.at(5000, 0, false)).toEqual({ width: '600' })
    expect(width.by(1, false)).toEqual({ width: '310' })
    expect(width.by(1000, false)).toEqual({ width: '600' })
  })

  it('puts the handle on the left edge of a right-aligned image', () => {
    const width = handle(image('right'), 'ImageFeature', { source: 'link', responsive: false, align: 'right' }, 'width')!
    expect(width.edge.x).toBe(300)
    expect(width.at(200, 0, false)).toEqual({ width: '400' })
  })

  it('sizes a responsive link image (its Width is a most), but not a responsive illustration', () => {
    expect(handle(image('left'), 'ImageFeature', { source: 'link', responsive: true, align: 'left' }, 'width')).toBeDefined()
    expect(handle(image('left'), 'ImageFeature', { source: 'illustration', illustration: 'spot/empty', responsive: true }, 'width')).toBeUndefined()
  })

  it('gives a banner a height in steps, snapping with marks at each step', () => {
    const container = page(`<div data-feature-id="2"></div>`)
    // 960 wide: short 160, medium 240, tall 300.
    box(container.querySelector('div')!, { left: 0, top: 100, width: 960, height: 240 })
    const height = handle(
      container,
      'ImageFeature',
      { source: 'illustration', illustration: 'banner/shapes', responsive: true, banner_height: 'medium' },
      'banner_height',
    )!
    expect(height).toMatchObject({ name: 'Height of Thing', axis: 'y', text: 'Medium', now: 1, edge: { y: 340 } })
    expect(height.at(0, 100 + 290, false)).toEqual({ banner_height: 'tall' })
    expect(height.at(0, 100 + 170, false)).toEqual({ banner_height: 'short' })
    // Just past the middle between medium and tall (270): still medium.
    expect(height.at(0, 100 + 272, false)).toEqual({ banner_height: 'medium' })
    expect(height.ticks()).toEqual([
      { at: 260, label: 'Short' },
      { at: 340, label: 'Medium' },
      { at: 400, label: 'Tall' },
    ])
    expect(height.by(1, false)).toEqual({ banner_height: 'tall' })
  })
})

describe('chart and map heights', () => {
  it('sizes a chart from its plot, not its title', () => {
    const container = page(`<figure data-feature-id="2"><figcaption></figcaption><div class="fd-chart-canvas"></div></figure>`)
    box(container.querySelector('figure')!, { left: 0, top: 0, width: 600, height: 360 })
    box(container.querySelector('.fd-chart-canvas')!, { left: 0, top: 60, width: 600, height: 300 })
    const height = handle(container, 'GoogleChartFeature', { height: 'medium' }, 'height')!
    expect(height.edge.y).toBe(360)
    expect(height.at(0, 60 + 400, false)).toEqual({ height: 'tall' })
    expect(height.at(0, 60 + 200, false)).toEqual({ height: 'short' })
  })

  it('has no chart handle until the plot shows', () => {
    const container = page(`<figure data-feature-id="2"><div class="fd-chart-canvas"></div></figure>`)
    box(container.querySelector('.fd-chart-canvas')!, { left: 0, top: 0, width: 600, height: 0 })
    expect(handle(container, 'GoogleChartFeature', { height: 'medium' }, 'height')).toBeUndefined()
  })

  it('sizes a map from its drawing', () => {
    const container = page(`<div data-feature-id="2"><div data-node-id="2.map"></div></div>`)
    // 600 wide: short 200, medium 300, tall 450.
    box(container.querySelector('[data-node-id="2.map"]')!, { left: 0, top: 50, width: 600, height: 300 })
    const height = handle(container, 'GoogleMapFeature', { height: 'medium' }, 'height')!
    expect(height.at(0, 50 + 440, false)).toEqual({ height: 'tall' })
  })
})

describe('separator width', () => {
  it('sizes a rule as a percentage of the room', () => {
    const container = page(`<div id="cell"><hr data-feature-id="2" /></div>`)
    Object.defineProperty(container.querySelector('#cell')!, 'clientWidth', { value: 800 })
    box(container.querySelector('hr')!, { left: 200, top: 10, width: 400, height: 1 })
    const width = handle(container, 'SeparatorFeature', { width: 50, align: 'center' }, 'width')!
    expect(width).toMatchObject({ text: '50%', now: 50, edge: { x: 600 } })
    expect(width.at(700, 0, false)).toEqual({ width: 75 })
    expect(width.by(-1, false)).toEqual({ width: 45 })
  })
})

describe('container column edges', () => {
  // A 900 px well with 45 px padding: columns from 45 to 855, with a 27 px gap.
  function grid(columns: number, stacked = false) {
    const cells = Array.from({ length: columns }, (_, i) => `<div data-slot="r1c${i + 1}"></div>`).join('')
    const container = page(`<div data-feature-id="2">${cells}</div>`)
    box(container.querySelector('[data-feature-id]')!, { left: 0, top: 0, width: 900, height: 200 })
    const tracks = 810 - 27 * (columns - 1)
    container.querySelectorAll('[data-slot]').forEach((cell, i) => {
      box(
        cell,
        stacked
          ? { left: 45, top: i * 100, width: 810, height: 90 }
          : { left: 45 + i * (tracks / columns + 27), top: 45, width: tracks / columns, height: 110 },
      )
    })
    return container
  }

  it('puts an edge in each gap, and the pointer where the edge lands gives those widths', () => {
    const container = grid(2)
    const edge = handle(container, 'ContainerFeature', { column_widths: '' }, 'edge-1')!
    expect(edge).toMatchObject({ name: 'Edge between columns 1 and 2 of Thing', text: '1 : 1', now: 6, axis: 'x' })
    expect(edge.edge.x).toBeCloseTo(450)
    // Columns 783 px wide in all: the edge after 2/3 of them sits at 45 + 522 + 13.5.
    expect(edge.at(45 + 522 + 13.5, 0, false)).toEqual({ column_widths: '2, 1' })
    // At the real 1/12 and 11/12 positions, not short of them (the well's padding is no column).
    expect(edge.at(45 + 783 / 12 + 13.5, 0, false)).toEqual({ column_widths: '1, 11' })
    expect(edge.at(45 + (783 * 11) / 12 + 13.5, 0, false)).toEqual({ column_widths: '11, 1' })
  })

  it('stores nothing for equal columns, so a click on the edge changes nothing', () => {
    const edge = handle(grid(2), 'ContainerFeature', { column_widths: '' }, 'edge-1')!
    expect(edge.at(450, 0, false)).toEqual({ column_widths: '' })
  })

  it('marks the twelfths along the columns', () => {
    const ticks = handle(grid(2), 'ContainerFeature', { column_widths: '' }, 'edge-1')!.ticks()
    expect(ticks).toHaveLength(11)
    expect(ticks[5]!.at).toBeCloseTo(450)
  })

  it('steps with the arrow keys and has no edges once the columns stack', () => {
    expect(handle(grid(3), 'ContainerFeature', { column_widths: '' }, 'edge-2')!.by(1, false)).toEqual({ column_widths: '4, 5, 3' })
    expect(resizeHandles(grid(2, true), 'ContainerFeature', '2', { column_widths: '' }, 'Thing')).toEqual([])
  })
})

describe('table Scroll after', () => {
  // A 40 px header, then rows of 116, 45 and 45 px (as the portfolio's wrapped descriptions render).
  function table(rows: number[], cards = false) {
    const container = page(
      `<section data-feature-id="2"><div class="fd-table-wrap"><table><thead><tr></tr></thead><tbody>${rows.map(() => '<tr></tr>').join('')}</tbody></table></div></section>`,
    )
    const wrap = container.querySelector<HTMLElement>('.fd-table-wrap')!
    const t = container.querySelector('table')!
    let bottom = 140
    box(t, { left: 0, top: 100, width: 600, height: 40 + rows.reduce((a, b) => a + b, 0) })
    container.querySelectorAll('tbody tr').forEach((tr, i) => {
      bottom += rows[i]!
      box(tr, { left: 0, top: bottom - rows[i]!, width: 600, height: rows[i]! })
    })
    box(wrap, { left: 0, top: 100, width: 600, height: bottom - 100 })
    styles.set(t, { display: cards ? 'block' : 'table' })
    styles.set(wrap, { fontSize: '16px' })
    return container
  }

  it('snaps to real row bottoms and shows every row past the last one', () => {
    const rows = handle(table([116, 45, 45, 45]), 'TableFeature', { scroll_rows: 0 }, 'scroll-rows')!
    expect(rows).toMatchObject({ name: 'Rows before Thing scrolls', text: 'All rows', axis: 'y' })
    // Row bottoms from the top: 156, 201, 246, 291.
    expect(rows.at(0, 100 + 250, false)).toEqual({ scroll_rows: 3 })
    expect(rows.at(0, 100 + 290, false)).toEqual({ scroll_rows: 4 })
    expect(rows.at(0, 100 + 320, false)).toEqual({ scroll_rows: 0 })
    expect(rows.ticks().map((t) => t.at)).toEqual([346, 391])
  })

  it('has no handle for one or two rows, or rows shown as cards', () => {
    expect(handle(table([45, 45]), 'TableFeature', { scroll_rows: 10 }, 'scroll-rows')).toBeUndefined()
    expect(handle(table([45, 45, 45, 45], true), 'TableFeature', { scroll_rows: 10 }, 'scroll-rows')).toBeUndefined()
  })

  it('has a handle before rows arrive, sized by the estimate', () => {
    const rows = handle(table([]), 'TableFeature', { scroll_rows: 10 }, 'scroll-rows')!
    expect(rows.text).toBe('10 rows')
    // 2.75em of 16 px = 44 px a row, the header included.
    expect(rows.at(0, 100 + 44 * 6, false)).toEqual({ scroll_rows: 5 })
    expect(rows.by(1, false)).toEqual({ scroll_rows: 11 })
  })

  it('sizes the scroll box to show exactly that many rows', () => {
    const wrap = table([116, 45, 45, 45]).querySelector<HTMLElement>('.fd-table-wrap')!
    expect(scrollFit(wrap, 3)).toBe('246px')
    expect(scrollFit(wrap, 4)).toBe('none')
    expect(scrollFit(table([]).querySelector<HTMLElement>('.fd-table-wrap')!, 3)).toBeUndefined()
    expect(scrollFit(table([45, 45, 45, 45], true).querySelector<HTMLElement>('.fd-table-wrap')!, 3)).toBeUndefined()
  })
})

describe('column presets', () => {
  it('offers common layouts for the number of columns', () => {
    expect(columnPresets(2).map((p) => p.text)).toEqual(['Equal', '2 : 1', '1 : 2', '3 : 1', '1 : 3'])
    expect(columnPresets(undefined).map((p) => p.value)).toEqual(['', '2, 1', '1, 2', '3, 1', '1, 3'])
    expect(columnPresets(3)[1]).toEqual({ text: '1 : 2 : 1', value: '1, 2, 1' })
    expect(columnPresets(6).map((p) => p.text)).toEqual(['Equal'])
    expect(columnPresets(1)).toEqual([])
  })

  it('recognizes stored widths however they were written', () => {
    expect(canonicalWidths('4,2', 2)).toBe('2, 1')
    expect(canonicalWidths('3, 3', 2)).toBe('')
    expect(canonicalWidths(undefined, 2)).toBe('')
    expect(canonicalWidths('x', 2)).toBeUndefined()
  })
})
