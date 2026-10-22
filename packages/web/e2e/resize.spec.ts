import { expect, test, type Page } from '@playwright/test'
import { isolateNetwork } from './network'
import { store, stored } from './storage'

// Sizes on the canvas, drawn as dimensions: dragging an edge or a dimension's pill, the arrow keys and typing only edit
// inputs, checked against the stored model. External requests are blocked.
isolateNetwork()

test.use({ viewport: { width: 1280, height: 900 } })

const canvas = (page: Page) => page.getByTestId('canvas')
const feature = (page: Page, id: string) => canvas(page).locator(`[data-feature-id="${id}"]`)
const select = (page: Page, id: string) => page.getByTestId('feature-tree').locator(`[data-tree-id="${id}"]`).click()
/** An edge's strip (the selected feature's), and a size's dimension pill (a slider, `<feature id>:<key>`). */
const handle = (page: Page, key: string) => page.locator(`[data-resize-handle="${key}"]`)
const dim = (page: Page, key: string, id?: string) => page.locator(id ? `[data-dimension="${id}:${key}"]` : `[data-dimension$=":${key}"]`)
const value = (page: Page, key: string, id?: string) => dim(page, key, id).getByTestId('dimension-value')
const inputs = async (id: string) => (await stored('resizing')).features.find((f) => f.id === id)?.inputs

test.beforeEach(async ({ page }) => {
  await store(page, {
    id: 'resizing',
    version: 2,
    name: 'Resizing',
    features: [
      { feature: 'ThemeFeature', id: '7', inputs: { name: 'House' } },
      { feature: 'PageFeature', id: '1', inputs: { name: 'Page', theme: '7' }, placement: { parent: '$root', slot: 'content' } },
      {
        feature: 'ImageFeature',
        id: '2',
        inputs: { name: 'Banner', source: 'illustration', illustration: 'banner/shapes', responsive: true, banner_height: 'medium' },
        placement: { parent: '1', slot: 'content' },
      },
      { feature: 'ContainerFeature', id: '3', inputs: { name: 'Columns', rows: 1, columns: 2 }, placement: { parent: '1', slot: 'content' } },
      { feature: 'TextFeature', id: '4', inputs: { text: 'Left column' }, placement: { parent: '3', slot: 'r1c1' } },
      { feature: 'TextFeature', id: '5', inputs: { text: 'Right column' }, placement: { parent: '3', slot: 'r1c2' } },
      {
        feature: 'GoogleMapFeature',
        id: '6',
        inputs: { name: 'Map', title: 'Find us', address: '1 Main St, Guilford, CT' },
        placement: { parent: '1', slot: 'content' },
      },
    ],
  })
  await page.goto('/models/resizing')
  await expect(page.getByTestId('save-state')).toHaveText('Saved')
})

/** Presses on an edge's strip (or a dimension's pill) and moves the mouse by (dx, dy) in steps, leaving the button down. */
async function pressAndMove(page: Page, key: string, dx: number, dy: number, on: 'edge' | 'pill' = 'edge') {
  const box = (await (on === 'edge' ? handle(page, key) : dim(page, key)).boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 8 })
}

test('drags a column edge to change the Column widths, as one undo step', async ({ page }) => {
  await select(page, '3')
  await expect(dim(page, 'edge-1')).toHaveAttribute('aria-valuetext', '1 : 1')
  const grid = (await feature(page, '3').boundingBox())!
  const edge = (await handle(page, 'edge-1').boundingBox())!
  // A third of the row further right: two thirds and one third.
  await pressAndMove(page, 'edge-1', grid.width / 6 + 2, 0)
  await expect(value(page, 'edge-1')).toHaveText('2 : 1')
  await page.mouse.up()
  await expect(dim(page, 'edge-1')).toHaveAttribute('aria-valuetext', '2 : 1')
  expect((await handle(page, 'edge-1').boundingBox())!.x).toBeGreaterThan(edge.x + grid.width / 8)
  // The page regenerated from the input; the selection is unchanged.
  await expect(page.getByTestId('inspector')).toContainText('Container #3')
  await expect.poll(async () => (await inputs('3'))?.column_widths).toBe('2, 1')
  const [left, right] = await Promise.all([feature(page, '4').boundingBox(), feature(page, '5').boundingBox()])
  expect(left!.width / right!.width).toBeCloseTo(2, 0)

  await page.getByTestId('undo').click()
  await expect(dim(page, 'edge-1')).toHaveAttribute('aria-valuetext', '1 : 1')
  await expect(page.getByTestId('undo')).toBeDisabled()
})

test('drags a banner to a named height or any % between, and Escape puts it back', async ({ page }) => {
  await select(page, '2')
  await expect(value(page, 'banner_height')).toHaveText('Height = Medium')
  // Responsive: the banner fills the width, so it has no width handle, only a reference dimension saying why.
  await expect(handle(page, 'width')).toHaveCount(0)
  const reference = page.getByTestId('reference-dimension')
  await expect(reference).toHaveText(/Width · fills the column/)
  await expect(reference).toContainText('Turn off Responsive to set a width')
  const banner = (await feature(page, '2').boundingBox())!

  // Short is a sixth of the width high, medium a quarter.
  await pressAndMove(page, 'banner_height', 0, -banner.width / 12)
  await expect(value(page, 'banner_height')).toHaveText('Height = Short')
  await expect(page.getByTestId('resize-tick')).toHaveCount(3)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(value(page, 'banner_height')).toHaveText('Height = Medium')
  await expect(page.getByTestId('undo')).toBeDisabled()

  // Between the named heights (by the pill this time): whole % of the width.
  await pressAndMove(page, 'banner_height', 0, banner.width * 0.15, 'pill')
  await page.mouse.up()
  await expect(value(page, 'banner_height')).toHaveText('Height = 40%')
  await expect.poll(async () => (await inputs('2'))?.banner_height).toBe('40%')
  const custom = (await feature(page, '2').boundingBox())!
  expect(custom.height).toBeCloseTo(custom.width * 0.4, 0)
  // The inspector shows it as a number, with no named height marked.
  await expect(page.getByTestId('inspector').locator('#input-banner_height')).toHaveValue('40')
  await expect(page.getByTestId('inspector').locator('[data-size-option][aria-pressed="true"]')).toHaveCount(0)
})

test('types a size on its dimension, refusing what it cannot read', async ({ page }) => {
  await select(page, '2')
  await dim(page, 'banner_height').dblclick()
  const field = page.getByTestId('dimension-input')
  await expect(field).toBeFocused()
  await expect(field).toHaveValue('Medium')
  await field.fill('huge')
  await field.press('Enter')
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByText("Can't read that.")).toBeVisible()
  await field.fill('28')
  await field.press('Enter')
  await expect(field).toHaveCount(0)
  await expect(value(page, 'banner_height')).toHaveText('Height = 28%')
  await expect(dim(page, 'banner_height')).toBeFocused()
  await expect.poll(async () => (await inputs('2'))?.banner_height).toBe('28%')

  // Enter on a focused dimension types too; Escape leaves it as it was.
  await page.keyboard.press('Enter')
  await field.fill('tall')
  await field.press('Escape')
  await expect(value(page, 'banner_height')).toHaveText('Height = 28%')

  await select(page, '3')
  await dim(page, 'edge-1').dblclick()
  await field.fill('1 : 3')
  await field.press('Enter')
  await expect.poll(async () => (await inputs('3'))?.column_widths).toBe('1, 3')
})

test('typing a size, then clicking elsewhere, applies it and leaves focus where the click put it', async ({ page }) => {
  await select(page, '2')
  await dim(page, 'banner_height').dblclick()
  await page.getByTestId('dimension-input').fill('35')
  const name = page.getByTestId('inspector').getByRole('textbox', { name: 'Name' })
  await name.click()
  await expect.poll(async () => (await inputs('2'))?.banner_height).toBe('35%')
  await expect(page.getByTestId('dimension-input')).toHaveCount(0)
  await expect(name).toBeFocused()
})

test('moves a focused dimension with the arrow keys', async ({ page }) => {
  await select(page, '2')
  await dim(page, 'banner_height').focus()
  await page.keyboard.press('ArrowDown')
  await expect(dim(page, 'banner_height')).toHaveAttribute('aria-valuetext', '24%')
  await expect(dim(page, 'banner_height')).toBeFocused()
  // Shift: the next named height.
  await page.keyboard.press('Shift+ArrowDown')
  await expect(dim(page, 'banner_height')).toHaveAttribute('aria-valuetext', 'Short')
  await expect.poll(async () => (await inputs('2'))?.banner_height).toBe('short')

  await select(page, '3')
  await dim(page, 'edge-1').focus()
  await page.keyboard.press('ArrowRight')
  await expect(dim(page, 'edge-1')).toHaveAttribute('aria-valuetext', '7 : 5')
  await expect.poll(async () => (await inputs('3'))?.column_widths).toBe('7, 5')
})

test("narrows a container with its Max width, and a page's content on its theme", async ({ page }) => {
  await select(page, '3')
  await expect(value(page, 'max-width')).toHaveText('Max width = Fills')
  const grid = (await feature(page, '3').boundingBox())!
  // Centered: the edge 100 px in narrows it by 200.
  await pressAndMove(page, 'max-width', -100, 0)
  await page.mouse.up()
  const expected = Math.round((grid.width - 200) / 10) * 10
  await expect(value(page, 'max-width')).toHaveText(`Max width = ${expected} px`)
  await expect.poll(async () => (await inputs('3'))?.max_width).toBe(String(expected))
  const narrow = (await feature(page, '3').boundingBox())!
  expect(narrow.width).toBeCloseTo(expected, 0)
  expect(narrow.x - grid.x).toBeCloseTo(grid.x + grid.width - (narrow.x + narrow.width), 0)
  await page.getByTestId('inspector').getByRole('button', { name: 'Left' }).click()
  await expect.poll(async () => (await feature(page, '3').boundingBox())!.x).toBeCloseTo(grid.x, 0)

  // The page's content width is its theme's, so dragging it changes the Theme.
  await select(page, '1')
  await expect(value(page, 'content-width')).toHaveText('Content width = 1120 px')
  await expect(dim(page, 'content-width').getByTestId('dimension-note')).toContainText('theme House')
  await dim(page, 'content-width').focus()
  await page.keyboard.press('Enter')
  await page.getByTestId('dimension-input').fill('480')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await inputs('7'))?.content_width).toBe('480')
  // The banner fills the content.
  await expect.poll(async () => (await feature(page, '2').boundingBox())!.width).toBeCloseTo(480, 0)
  // A page width of its own takes over.
  await page.getByTestId('inspector').locator('[data-size-option="960"]').click()
  await expect(dim(page, 'content-width').getByTestId('dimension-note')).toContainText('this page')
  await expect.poll(async () => (await inputs('1'))?.content_width).toBe('960')
  expect((await inputs('7'))?.content_width).toBe('480')
})

test('makes a container taller than its content with a Min height, placing the content in it', async ({ page }) => {
  await select(page, '3')
  await expect(value(page, 'min-height')).toHaveText('Min height = Fits content')
  const before = (await feature(page, '3').boundingBox())!
  await pressAndMove(page, 'min-height', 0, 150)
  await page.mouse.up()
  const expected = Math.round((before.height + 150) / 10) * 10
  await expect(value(page, 'min-height')).toHaveText(`Min height = ${expected} px`)
  await expect.poll(async () => (await inputs('3'))?.min_height).toBe(String(expected))
  expect((await feature(page, '3').boundingBox())!.height).toBeCloseTo(expected, 0)

  // Stretched (the default), the cells fill the height; in the middle, the text sits centered.
  const top = async () => (await feature(page, '4').boundingBox())!.y
  const stretched = await top()
  await page.getByTestId('inspector').getByRole('button', { name: 'Center' }).click()
  await expect.poll(async () => (await inputs('3'))?.vertical_align).toBe('center')
  await expect.poll(top).toBeGreaterThan(stretched + 50)

  // Back above what the content needs: it fits its content again.
  await pressAndMove(page, 'min-height', 0, -300)
  await page.mouse.up()
  await expect.poll(async () => (await inputs('3'))?.min_height).toBe('')
  await expect(value(page, 'min-height')).toHaveText('Min height = Fits content')
  expect((await feature(page, '3').boundingBox())!.height).toBeCloseTo(before.height, 0)
})

test('shows every feature’s dimensions with All, and a press on one selects its feature', async ({ page }) => {
  await expect(page.getByTestId('dimension')).toHaveCount(0)
  await page.getByTestId('dimensions-all').click()
  await expect(dim(page, 'banner_height', '2')).toBeVisible()
  await expect(dim(page, 'height', '6')).toBeVisible()
  await expect(dim(page, 'content-width', '1')).toBeVisible()
  // Only the selected feature has edges to drag.
  await expect(page.locator('[data-resize-handle]')).toHaveCount(0)
  await pressAndMove(page, 'height', 0, 60, 'pill')
  await page.mouse.up()
  await expect(page.getByTestId('inspector')).toContainText('Map #6')
  await expect.poll(async () => (await inputs('6'))?.height).toMatch(/^\d+%$|^tall$/)
  // Remembered for this browser.
  await page.reload()
  await expect(page.getByTestId('dimensions-all')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('dimensions-selected').click()
  await expect(page.getByTestId('dimension')).toHaveCount(0)
})

test('has no dimensions while text is edited in place, or column edges once stacked at phone width', async ({ page }) => {
  await select(page, '3')
  await expect(handle(page, 'edge-1')).toBeVisible()
  await page.getByTestId('canvas-width-phone').click()
  await expect(handle(page, 'edge-1')).toHaveCount(0)
  await page.getByTestId('canvas-width-desktop').click()
  await expect(handle(page, 'edge-1')).toBeVisible()

  await select(page, '6')
  await expect(dim(page, 'height')).toHaveAttribute('aria-valuetext', 'Medium')
  await feature(page, '6').getByText('Find us').dblclick()
  await expect(canvas(page).locator('[contenteditable]')).toHaveCount(1)
  await expect(page.getByTestId('resize-handles')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(handle(page, 'height')).toBeVisible()
})

test('picks a column layout from the presets beside Column widths', async ({ page }) => {
  await select(page, '3')
  await page.getByTestId('inspector').locator('[data-preset="1, 2"]').click()
  await expect(dim(page, 'edge-1')).toHaveAttribute('aria-valuetext', '1 : 2')
  await expect(page.getByTestId('inspector').locator('[data-preset="1, 2"]')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await inputs('3'))?.column_widths).toBe('1, 2')
  await page.getByTestId('inspector').locator('[data-preset="equal"]').click()
  await expect(dim(page, 'edge-1')).toHaveAttribute('aria-valuetext', '1 : 1')
})

test.describe('data and pictures', () => {
  const LONG = 'A description long enough to wrap onto several lines in a table cell, so this row is much taller than the others are.'
  const rows = [
    { name: 'Alpha', about: LONG, n: 4 },
    { name: 'Beta', about: 'Short', n: 7 },
    { name: 'Gamma', about: 'Short', n: 2 },
    { name: 'Delta', about: 'Short', n: 9 },
    { name: 'Epsilon', about: LONG, n: 5 },
    { name: 'Zeta', about: 'Short', n: 3 },
  ]
  const picture = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#8a8"/></svg>')}`

  test.beforeEach(async ({ page }) => {
    await store(page, {
      id: 'resizing-data',
      version: 2,
      name: 'Resizing data',
      features: [
        { feature: 'DataResourceFeature', id: '1', inputs: { name: 'Items', source: 'sample', sample_rows: JSON.stringify(rows) } },
        { feature: 'PageFeature', id: '2', inputs: { name: 'Page' }, placement: { parent: '$root', slot: 'content' } },
        {
          feature: 'TableFeature',
          id: '3',
          inputs: { name: 'Items table', data_resource: '1', fields: ['name', 'about'], scroll_rows: 10 },
          placement: { parent: '2', slot: 'content' },
        },
        {
          feature: 'GoogleChartFeature',
          id: '4',
          inputs: { name: 'Items chart', data_resource: '1', label_field: 'name', value_field: 'n', height: 'medium' },
          placement: { parent: '2', slot: 'content' },
        },
        {
          feature: 'ImageFeature',
          id: '5',
          inputs: { name: 'Photo', source: 'link', src: picture, alt: 'A green field', responsive: false, width: '300', height: '200', align: 'left' },
          placement: { parent: '2', slot: 'content' },
        },
      ],
    })
    await page.goto('/models/resizing-data')
    await expect(page.getByTestId('save-state')).toHaveText('Saved')
  })

  const dataInputs = async (id: string) => (await stored('resizing-data')).features.find((f) => f.id === id)?.inputs

  test('drags a table to show exactly that many rows, however tall they are', async ({ page }) => {
    await select(page, '3')
    const wrap = feature(page, '3').locator('.fd-table-wrap')
    await expect(wrap.locator('tbody tr')).toHaveCount(6)
    // Six rows fit within Scroll after 10, so every row shows.
    await expect(dim(page, 'scroll-rows')).toHaveAttribute('aria-valuetext', '10 rows')
    const bottoms = await wrap.evaluate((el) => {
      const top = el.getBoundingClientRect().top
      return [...el.querySelectorAll('tbody tr')].map((tr) => tr.getBoundingClientRect().bottom - top)
    })
    // The first row wraps: it is much taller than the 2.75em the old estimate assumed.
    expect(bottoms[0]! - (await wrap.locator('thead').evaluate((el) => el.getBoundingClientRect().height))).toBeGreaterThan(60)
    const grip = (await handle(page, 'scroll-rows').boundingBox())!
    const top = (await wrap.boundingBox())!.y
    await pressAndMove(page, 'scroll-rows', 0, top + bottoms[2]! - (grip.y + grip.height / 2))
    await expect(page.getByTestId('resize-tick').first()).toBeVisible()
    await page.mouse.up()
    await expect(dim(page, 'scroll-rows')).toHaveAttribute('aria-valuetext', '3 rows')
    await expect.poll(async () => (await dataInputs('3'))?.scroll_rows).toBe(3)
    // The box ends at the third row's bottom, on the editor canvas and in the preview alike.
    await expect.poll(() => wrap.evaluate((el) => el.clientHeight)).toBeCloseTo(bottoms[2]!, -1)
    await page.goto('/preview.html?model=resizing-data')
    const preview = page.locator('.fd-table-wrap')
    await expect(preview.locator('tbody tr')).toHaveCount(6)
    // The preview is wider, so its rows wrap less: its box ends at its own third row.
    const third = () =>
      preview.evaluate((el) => [el.clientHeight, el.querySelectorAll('tbody tr')[2]!.getBoundingClientRect().bottom - el.getBoundingClientRect().top])
    await expect
      .poll(async () => {
        const [height, bottom] = await third()
        return Math.abs(height! - bottom!)
      })
      .toBeLessThan(2)
  })

  test('drags a chart taller and an image wider, with the hint shown on hover', async ({ page }) => {
    await select(page, '4')
    await expect(feature(page, '4').locator('canvas')).toBeVisible()
    // A tall window, so the drag stays clear of the canvas's edge, where it scrolls (and the height would keep growing).
    await page.setViewportSize({ width: 1280, height: 1600 })
    await pressAndMove(page, 'height', 0, 100)
    await page.mouse.up()
    await expect(dim(page, 'height')).toHaveAttribute('aria-valuetext', 'Tall')
    await expect.poll(async () => (await dataInputs('4'))?.height).toBe('tall')
    await expect(page.getByTestId('resize-announcement')).toHaveText('Height of Items chart: Tall')

    await select(page, '5')
    await expect(value(page, 'width')).toHaveText('Width = 300 px')
    await handle(page, 'width').hover()
    await expect(page.getByTestId('resize-hint')).toBeVisible()
    await pressAndMove(page, 'width', 100, 0)
    await page.mouse.up()
    await expect(dim(page, 'width')).toHaveAttribute('aria-valuetext', '400 px')
    await expect.poll(async () => (await dataInputs('5'))?.width).toBe('400')
    // The press focused the dimension, so the arrow keys carry on from it.
    await expect(dim(page, 'width')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect.poll(async () => (await dataInputs('5'))?.width).toBe('410')
  })
})
