import { describe, expect, it } from 'vitest'
import {
  BANNER_HEIGHT_SCALE,
  CHART_HEIGHT_SCALE,
  clampThemeParams,
  ContainerFeature,
  CONTENT_WIDTH_SCALE,
  DEFAULT_THEME,
  deriveTokens,
  formatDiagnostic,
  formatHeight,
  generate,
  heightText,
  isInputShown,
  MAP_HEIGHT_SCALE,
  matchingPreset,
  MAX_WIDTH_SCALE,
  readHeight,
  readWidth,
  snapWidth,
  themeInputs,
  themeParams,
  widthCss,
  widthText,
  type DocNode,
  type DocNodeOf,
} from '../src'
import { inst, model, page } from './helpers'

const generated = (...features: Parameters<typeof model>) => {
  const r = generate(model(...features))
  return { page: r.root.children[0] as DocNodeOf<'page'>, problems: r.diagnostics.map(formatDiagnostic) }
}
const first = (p: DocNode) => p.children[0]!

describe('height scales', () => {
  it('read names, and numbers in the scale unit (which may be left out), snapped to the step and range', () => {
    expect(readHeight('medium', BANNER_HEIGHT_SCALE)).toEqual({ value: 25, name: 'medium' })
    expect(readHeight(' Tall ', BANNER_HEIGHT_SCALE)).toEqual({ value: 31.25, name: 'tall' })
    expect(readHeight('28%', BANNER_HEIGHT_SCALE)).toEqual({ value: 28 })
    expect(readHeight('28', BANNER_HEIGHT_SCALE)).toEqual({ value: 28 })
    expect(readHeight('28.4 %', BANNER_HEIGHT_SCALE)).toEqual({ value: 28 })
    expect(readHeight('5%', BANNER_HEIGHT_SCALE)).toEqual({ value: 10 })
    expect(readHeight('90%', BANNER_HEIGHT_SCALE)).toEqual({ value: 60 })
    expect(readHeight('263px', CHART_HEIGHT_SCALE)).toEqual({ value: 260 })
    expect(readHeight('263', CHART_HEIGHT_SCALE)).toEqual({ value: 260 })
  })

  it('refuse other units, words and prototype keys', () => {
    for (const bad of ['28px', 'huge', '', '-5%', 'constructor', '__proto__', '1e3']) expect(readHeight(bad, BANNER_HEIGHT_SCALE), bad).toBeUndefined()
    expect(readHeight('30%', CHART_HEIGHT_SCALE)).toBeUndefined()
  })

  it('store a name as the name and a number with its unit, and say either in words', () => {
    expect(formatHeight({ value: 25, name: 'medium' }, BANNER_HEIGHT_SCALE)).toBe('medium')
    expect(formatHeight({ value: 28.2 }, BANNER_HEIGHT_SCALE)).toBe('28%')
    expect(formatHeight({ value: 255 }, CHART_HEIGHT_SCALE)).toBe('260px')
    expect(heightText({ value: 25, name: 'medium' }, BANNER_HEIGHT_SCALE)).toBe('Medium')
    expect(heightText({ value: 28 }, BANNER_HEIGHT_SCALE)).toBe('28%')
    expect(heightText({ value: 260 }, CHART_HEIGHT_SCALE)).toBe('260 px')
  })

  it('give the named heights their old shapes, so stored banners and maps look the same', () => {
    expect(BANNER_HEIGHT_SCALE.named).toEqual({ short: 100 / 6, medium: 25, tall: 31.25 })
    expect(MAP_HEIGHT_SCALE.named).toEqual({ short: 100 / 3, medium: 50, tall: 75 })
  })
})

describe('banner, map and chart heights', () => {
  const banner = (banner_height: string) =>
    generated(page(), inst('ImageFeature', 'b', { source: 'illustration', illustration: 'banner/shapes', banner_height }))

  it('make a banner any % of its width as well as short, medium or tall', () => {
    expect(first(banner('medium').page).props).toMatchObject({ aspect: 4 })
    expect(first(banner('20%').page).props).toMatchObject({ aspect: 5 })
    expect(banner('20%').problems).toEqual([])
  })

  it('warn about a height that is neither, and use medium', () => {
    const { page: p, problems } = banner('huge')
    expect(first(p).props).toMatchObject({ aspect: 4 })
    expect(problems).toEqual(['warning feature [b]: Height "huge" should be short, medium, tall or a % of the width; using medium'])
  })

  it('make a map any % of its width', () => {
    const { page: p, problems } = generated(page(), inst('GoogleMapFeature', 'm', { address: 'Main St', height: '40%' }))
    expect(problems).toEqual([])
    expect(first(p).children.find((n) => n.kind === 'illustration')!.props).toMatchObject({ aspect: 2.5 })
  })

  it('make a chart any height in pixels', () => {
    const rows = inst('DataResourceFeature', 'r', { source: 'sample', sample_rows: '[{"a": 1}]' }, null)
    const chart = (height: string) => generated(rows, page(), inst('GoogleChartFeature', 'c', { data_resource: 'r', height }))
    expect(first(chart('260px').page).props).toMatchObject({ height: 260 })
    expect(first(chart('tall').page).props).toMatchObject({ height: 400 })
    expect(chart('40%').problems).toEqual(['warning feature [c]: Height "40%" should be short, medium, tall or pixels; using medium'])
    expect(first(chart('40%').page).props).toMatchObject({ height: 300 })
  })
})

describe('widths', () => {
  it('read full (or none) and whole pixels, kept in range', () => {
    expect(readWidth('full', CONTENT_WIDTH_SCALE)).toBe('full')
    expect(readWidth(' None ', CONTENT_WIDTH_SCALE)).toBe('full')
    expect(readWidth('960', CONTENT_WIDTH_SCALE)).toBe(960)
    expect(readWidth('960px', CONTENT_WIDTH_SCALE)).toBe(960)
    expect(readWidth(960, CONTENT_WIDTH_SCALE)).toBe(960)
    expect(readWidth('100', CONTENT_WIDTH_SCALE)).toBe(480)
    expect(readWidth('9000', CONTENT_WIDTH_SCALE)).toBe(1600)
    for (const bad of ['', 'wide', '960.5', '50%', '-1']) expect(readWidth(bad, CONTENT_WIDTH_SCALE), bad).toBeUndefined()
  })

  it('snap to the step, and read as words and CSS', () => {
    expect(snapWidth(963, MAX_WIDTH_SCALE)).toBe(960)
    expect(snapWidth(10, MAX_WIDTH_SCALE)).toBe(240)
    expect(widthText(960)).toBe('960 px')
    expect(widthText('full')).toBe('Full')
    expect(widthCss('full')).toBe('100%')
  })
})

describe('Container max width', () => {
  const grid = (inputs: Record<string, string>) => generated(page(), inst('ContainerFeature', 'g', inputs))

  it('fills the page without one, as stored containers do', () => {
    expect(first(grid({}).page).props).toEqual({ rows: 1, columns: 2, well: true })
    expect(first(grid({ max_width: 'full', align: 'left' }).page).props).toEqual({ rows: 1, columns: 2, well: true })
  })

  it('sets the widest it gets and where it sits', () => {
    expect(first(grid({ max_width: '640' }).page).props).toMatchObject({ maxWidth: 640, align: 'center' })
    expect(first(grid({ max_width: '640', align: 'left' }).page).props).toMatchObject({ maxWidth: 640, align: 'left' })
    expect(first(grid({ max_width: '10', align: 'nope' }).page).props).toMatchObject({ maxWidth: 240, align: 'center' })
  })

  it('warns about a width that is not whole pixels, and fills', () => {
    const { page: p, problems } = grid({ max_width: '50%' })
    expect(first(p).props).not.toHaveProperty('maxWidth')
    expect(problems).toEqual(['warning feature [g]: Max width "50%" should be whole pixels such as 640; filling the page'])
  })
})

describe('Container min height', () => {
  const grid = (inputs: Record<string, string>) => generated(page(), inst('ContainerFeature', 'g', inputs))

  it('fits its content without one', () => {
    expect(first(grid({ vertical_align: 'center' }).page).props).toEqual({ rows: 1, columns: 2, well: true })
  })

  it('sets the least it is tall, its rows stretching unless placed at the top or in the middle', () => {
    expect(first(grid({ min_height: '400' }).page).props).toEqual({ rows: 1, columns: 2, well: true, minHeight: 400 })
    expect(first(grid({ min_height: '400px', vertical_align: 'center' }).page).props).toMatchObject({ minHeight: 400, verticalAlign: 'center' })
    expect(first(grid({ min_height: '5', vertical_align: 'nope' }).page).props).toEqual({ rows: 1, columns: 2, well: true, minHeight: 40 })
  })

  it('warns about a height that is not whole pixels, and fits the content', () => {
    const { page: p, problems } = grid({ min_height: 'tall' })
    expect(first(p).props).not.toHaveProperty('minHeight')
    expect(problems).toEqual(['warning feature [g]: Min height "tall" should be whole pixels such as 400; fitting the content'])
  })

  it('shows Content (vertical alignment) only with a min height', () => {
    const valign = ContainerFeature.inputs.find((i) => i.name === 'vertical_align')!
    expect(isInputShown(valign, ContainerFeature.inputs, {})).toBe(false)
    expect(isInputShown(valign, ContainerFeature.inputs, { min_height: '400' })).toBe(true)
  })
})

describe('content width', () => {
  it('is a theme setting, 1120 px by default, emitted as a token', () => {
    expect(DEFAULT_THEME.contentWidth).toBe(1120)
    expect(deriveTokens().vars['--fd-content-width']).toBe('1120px')
    expect(deriveTokens({ ...DEFAULT_THEME, contentWidth: 'full' }).vars['--fd-content-width']).toBe('100%')
    expect(clampThemeParams({ contentWidth: '960' }).contentWidth).toBe(960)
    expect(clampThemeParams({ contentWidth: 'wide' }).contentWidth).toBe(1120)
  })

  it('round-trips through a Theme’s inputs, and stored themes without it still match their built-in theme', () => {
    expect(themeInputs(DEFAULT_THEME)).toMatchObject({ content_width: '1120' })
    expect(themeParams({ content_width: 'full' }).contentWidth).toBe('full')
    expect(matchingPreset({})?.id).toBe('warm-editorial')
    expect(matchingPreset({ content_width: '960' })).toBeUndefined()
    expect(matchingPreset({ content_width: 'wide' })).toBeUndefined()
  })

  it('comes from the page’s theme, and a page can set its own', () => {
    const theme = inst('ThemeFeature', 't', { content_width: '960' }, null)
    const themed = generated(theme, page({ theme: 't' }))
    expect(themed.problems).toEqual([])
    expect(themed.page.props.theme?.vars['--fd-content-width']).toBe('960px')
    expect(themed.page.props).not.toHaveProperty('contentWidth')
    expect(generated(theme, page({ theme: 't', content_width: '720' })).page.props.contentWidth).toBe('720px')
    expect(generated(page({ content_width: 'full' })).page.props.contentWidth).toBe('100%')
  })

  it('warns about widths that are neither pixels nor full', () => {
    expect(generated(page({ content_width: 'wide' })).problems).toEqual([
      'warning feature [1]: Content width "wide" should be whole pixels such as 960, or full; using the theme\'s',
    ])
    expect(generated(inst('ThemeFeature', 't', { content_width: '50%' }, null), page({ theme: 't' })).problems).toEqual([
      'warning feature [t]: Content width "50%" should be whole pixels such as 960, or full; using 1120',
    ])
  })
})
