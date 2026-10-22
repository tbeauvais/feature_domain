import { afterEach, describe, expect, it, vi } from 'vitest'
import { canonicalWidths, columnPresets } from '../src/editor/columnPresets'
import { referenceDimensions, resizeHandles } from '../src/editor/resizeHandles'
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

  it('gives a banner a height as a % of its width, sticking to the named heights', () => {
    const container = page(`<div data-feature-id="2"></div>`)
    // 960 wide: short 160, medium 240, tall 300.
    box(container.querySelector('div')!, { left: 0, top: 100, width: 960, height: 240 })
    const height = handle(
      container,
      'ImageFeature',
      { source: 'illustration', illustration: 'banner/shapes', responsive: true, banner_height: 'medium' },
      'banner_height',
    )!
    expect(height).toMatchObject({ name: 'Height of Thing', label: 'Height', axis: 'y', text: 'Medium', now: 25, min: 10, max: 60, edge: { y: 340 } })
    // Within 8 px of a named height: that name.
    expect(height.at(0, 100 + 294, false)).toEqual({ banner_height: 'tall' })
    expect(height.at(0, 100 + 165, false)).toEqual({ banner_height: 'short' })
    // Between them: whole % of the width (260 / 960 = 27.1%).
    expect(height.at(0, 100 + 260, false)).toEqual({ banner_height: '27%' })
    // The current name holds a little further (hysteresis).
    expect(height.at(0, 100 + 252, false)).toEqual({ banner_height: 'medium' })
    expect(height.ticks()).toEqual([
      { at: 260, label: 'Short' },
      { at: 340, label: 'Medium' },
      { at: 400, label: 'Tall' },
    ])
    expect(height.by(1, false)).toEqual({ banner_height: '26%' })
    expect(height.by(-1, false)).toEqual({ banner_height: '24%' })
    expect(height.by(1, true)).toEqual({ banner_height: 'tall' })
    expect(height.parse('28')).toEqual({ banner_height: '28%' })
    expect(height.parse('28 %')).toEqual({ banner_height: '28%' })
    expect(height.parse('Tall')).toEqual({ banner_height: 'tall' })
    expect(height.parse('huge')).toBeUndefined()
    expect(height.dimension).toEqual({ from: 100, to: 340, at: 960 + 18, pill: 220 })
  })

  it('reads a banner height stored as a %', () => {
    const container = page(`<div data-feature-id="2"></div>`)
    box(container.querySelector('div')!, { left: 0, top: 100, width: 960, height: 270 })
    const height = handle(
      container,
      'ImageFeature',
      { source: 'illustration', illustration: 'banner/shapes', responsive: true, banner_height: '28%' },
      'banner_height',
    )!
    expect(height).toMatchObject({ text: '28%', now: 28 })
    expect(height.by(1, true)).toEqual({ banner_height: 'tall' })
    expect(height.by(-1, true)).toEqual({ banner_height: 'medium' })
  })
})

describe('chart and map heights', () => {
  it('sizes a chart from its plot, not its title', () => {
    const container = page(`<figure data-feature-id="2"><figcaption></figcaption><div class="fd-chart-canvas"></div></figure>`)
    box(container.querySelector('figure')!, { left: 0, top: 0, width: 600, height: 360 })
    box(container.querySelector('.fd-chart-canvas')!, { left: 0, top: 60, width: 600, height: 300 })
    const height = handle(container, 'GoogleChartFeature', { height: 'medium' }, 'height')!
    expect(height.edge.y).toBe(360)
    expect(height).toMatchObject({ text: 'Medium', now: 300, min: 160, max: 640 })
    expect(height.at(0, 60 + 404, false)).toEqual({ height: 'tall' })
    expect(height.at(0, 60 + 225, false)).toEqual({ height: 'short' })
    // Between them, pixels in steps of 10.
    expect(height.at(0, 60 + 262, false)).toEqual({ height: '260px' })
    expect(height.parse('265 px')).toEqual({ height: '270px' })
    expect(height.parse('40%')).toBeUndefined()
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
    expect(height.at(0, 50 + 446, false)).toEqual({ height: 'tall' })
    expect(height.at(0, 50 + 240, false)).toEqual({ height: '40%' })
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
    expect(resizeHandles(grid(2, true), 'ContainerFeature', '2', { column_widths: '' }, 'Thing').filter((h) => h.key.startsWith('edge'))).toEqual([])
  })
})

describe('typed values', () => {
  it('reads widths, shares and rows as they are shown or plainer', () => {
    const container = page(`<div id="cell"><img data-feature-id="2" /></div>`)
    box(container.querySelector('#cell')!, { left: 0, top: 0, width: 600, height: 300 })
    Object.defineProperty(container.querySelector('#cell')!, 'clientWidth', { value: 600 })
    box(container.querySelector('img')!, { left: 0, top: 0, width: 300, height: 200 })
    const width = handle(container, 'ImageFeature', { source: 'link', responsive: false, align: 'left' }, 'width')!
    expect(width.parse('320 px')).toEqual({ width: '320' })
    expect(width.parse('9000')).toEqual({ width: '600' })
    expect(width.parse('wide')).toBeUndefined()
  })
})

describe('container max width', () => {
  // A container in a 900 px page cell, centered.
  function grid(width: number, left = 0) {
    const container = page(`<div id="room"><div data-feature-id="2"><div data-slot="r1c1"></div></div></div>`)
    Object.defineProperty(container.querySelector('#room')!, 'clientWidth', { value: 900 })
    box(container.querySelector('#room')!, { left: 0, top: 0, width: 900, height: 400 })
    box(container.querySelector('[data-feature-id]')!, { left, top: 100, width, height: 200 })
    return container
  }

  it('fills the page without one, and narrows from its outer edge (both sides when centered)', () => {
    const max = handle(grid(900), 'ContainerFeature', { max_width: '', align: 'center' }, 'max-width')!
    expect(max).toMatchObject({ name: 'Max width of Thing', label: 'Max width', text: 'Fills', axis: 'x', edge: { x: 900 } })
    // Below the container, along its width.
    expect(max.dimension).toEqual({ from: 0, to: 900, at: 318, pill: 450 })
    expect(max.at(800, 0, false)).toEqual({ max_width: '700' })
    expect(max.at(898, 0, false)).toEqual({ max_width: '' })
    expect(max.by(-1, false)).toEqual({ max_width: '890' })
  })

  it('reads its stored width and alignment, and fills again past the room', () => {
    const max = handle(grid(600), 'ContainerFeature', { max_width: '600', align: 'left' }, 'max-width')!
    expect(max).toMatchObject({ text: '600 px', edge: { x: 600 } })
    expect(max.at(640, 0, false)).toEqual({ max_width: '640' })
    expect(max.at(5000, 0, false)).toEqual({ max_width: '' })
    expect(max.by(1, false)).toEqual({ max_width: '610' })
    expect(max.parse('fills')).toEqual({ max_width: '' })
    expect(max.parse('480 px')).toEqual({ max_width: '480' })
    expect(max.parse('half')).toBeUndefined()
  })

  it('gives it a min height from its bottom edge, fitting its content again above what that needs', () => {
    // 200 px tall with its content (jsdom has no layout, so lifting the min height measures the same).
    const min = handle(grid(900), 'ContainerFeature', { min_height: '' }, 'min-height')!
    expect(min).toMatchObject({ name: 'Min height of Thing', label: 'Min height', text: 'Fits content', axis: 'y', edge: { y: 300 } })
    expect(min.at(0, 100 + 333, false)).toEqual({ min_height: '330' })
    expect(min.at(0, 100 + 204, false)).toEqual({ min_height: '' })
    expect(min.by(1, false)).toEqual({ min_height: '210' })
    expect(min.by(-1, false)).toEqual({ min_height: '' })
    expect(min.ticks()).toEqual([{ at: 300, label: 'Fits content' }])
    expect(min.parse('fits')).toEqual({ min_height: '' })
    expect(min.parse('450 px')).toEqual({ min_height: '450' })
    expect(min.parse('tall')).toBeUndefined()
    // A min height its content outgrows says so.
    expect(handle(grid(900), 'ContainerFeature', { min_height: '150' }, 'min-height')).toMatchObject({ text: '150 px', note: 'content 200 px' })
  })

  it('reads typed column shares for every column', () => {
    const container = page(`<div data-feature-id="2"><div data-slot="r1c1"></div><div data-slot="r1c2"></div></div>`)
    box(container.querySelector('[data-feature-id]')!, { left: 0, top: 0, width: 900, height: 200 })
    box(container.querySelector('[data-slot="r1c1"]')!, { left: 0, top: 0, width: 440, height: 200 })
    box(container.querySelector('[data-slot="r1c2"]')!, { left: 460, top: 0, width: 440, height: 200 })
    const edge = handle(container, 'ContainerFeature', { column_widths: '' }, 'edge-1')!
    expect(edge.parse('2 : 1')).toEqual({ column_widths: '2, 1' })
    expect(edge.parse('4, 2')).toEqual({ column_widths: '2, 1' })
    expect(edge.parse('1 : 1')).toEqual({ column_widths: '' })
    expect(edge.parse('2 : 1 : 1')).toBeUndefined()
    expect(edge.parse('0 : 1')).toBeUndefined()
  })
})

describe('page content width', () => {
  // A 1000 px document; the page's side padding leaves 600 px of content.
  function pageEl() {
    const container = page(`<div class="fd-root"><div data-feature-id="1"></div></div>`)
    box(container.querySelector('.fd-root')!, { left: 0, top: 0, width: 1000, height: 800 })
    const el = container.querySelector<HTMLElement>('[data-feature-id]')!
    box(el, { left: 0, top: 0, width: 1000, height: 800 })
    styles.set(el, { paddingLeft: '200px', paddingRight: '200px', paddingTop: '48px', getPropertyValue: (() => '8px') as never })
    return container
  }
  const lookup = (id: string) => (id === 't' ? { feature: 'ThemeFeature', inputs: { content_width: '600' }, name: 'Harbor' } : undefined)
  const width = (inputs: Record<string, unknown>) =>
    resizeHandles(pageEl(), 'PageFeature', '1', inputs as never, 'Page', lookup).find((h) => h.key === 'content-width')!

  it("sets the theme's content width when the page has none of its own", () => {
    const w = width({ theme: 't', content_width: '' })
    expect(w).toMatchObject({ name: 'Content width of Page', label: 'Content width', text: '600 px', note: 'theme Harbor', feature: 't', edge: { x: 800 } })
    expect(w.dimension).toEqual({ from: 200, to: 800, at: 800 - 18, pill: 500 })
    // Centered: the edge 50 px in narrows it by 100.
    expect(w.at(750, 0, false)).toEqual({ content_width: '500' })
    expect(w.by(1, false)).toEqual({ content_width: '610' })
  })

  it('sets its own once it has one, and says when this canvas shows less than it', () => {
    const own = width({ theme: 't', content_width: '1120' })
    expect(own).toMatchObject({ text: '1120 px', note: 'this page · 600 px here', feature: '1' })
    // Dragged to the edge of what this canvas can show (1000 - 2 × 40 px of padding): the wider value stays.
    expect(own.at(970, 0, false)).toEqual({ content_width: '1120' })
    expect(own.at(750, 0, false)).toEqual({ content_width: '500' })
    expect(own.parse('Narrow')).toEqual({ content_width: '720' })
    expect(own.parse('full')).toEqual({ content_width: 'full' })
    expect(own.parse('960 px')).toEqual({ content_width: '960' })
    expect(own.parse('wide-ish')).toBeUndefined()
  })

  it('without a theme, sets the page’s own', () => {
    expect(width({ theme: '', content_width: '' })).toMatchObject({ text: '1120 px', note: 'default theme · 600 px here', feature: '1' })
  })
})

describe('reference dimensions', () => {
  it('say why a responsive illustration and a header have no size to set', () => {
    const container = page(`<div data-feature-id="2"></div>`)
    box(container.querySelector('div')!, { left: 10, top: 100, width: 600, height: 150 })
    expect(referenceDimensions(container, 'ImageFeature', '2', { source: 'illustration', responsive: true }).map((r) => r.text)).toEqual([
      'Width · fills the column',
    ])
    expect(referenceDimensions(container, 'ImageFeature', '2', { source: 'link', responsive: true })).toEqual([])
    expect(referenceDimensions(container, 'HeaderFeature', '2', {})).toMatchObject([{ axis: 'y', text: 'Height · follows the text' }])
    expect(referenceDimensions(container, 'TextFeature', '2', {})).toEqual([])
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
    expect(rows.parse('8 rows')).toEqual({ scroll_rows: 8 })
    expect(rows.parse('All rows')).toEqual({ scroll_rows: 0 })
    expect(rows.parse('2')).toEqual({ scroll_rows: 3 })
    expect(rows.parse('500')).toEqual({ scroll_rows: 0 })
    expect(rows.parse('some')).toBeUndefined()
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
