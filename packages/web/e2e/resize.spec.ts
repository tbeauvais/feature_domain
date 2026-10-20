import { expect, test, type Page } from '@playwright/test'
import { isolateNetwork } from './network'
import { store, stored } from './storage'

// Resize handles on the canvas: a drag only edits inputs, checked against the stored model. External requests are blocked.
isolateNetwork()

test.use({ viewport: { width: 1280, height: 900 } })

const canvas = (page: Page) => page.getByTestId('canvas')
const feature = (page: Page, id: string) => canvas(page).locator(`[data-feature-id="${id}"]`)
const select = (page: Page, id: string) => page.getByTestId('feature-tree').locator(`[data-tree-id="${id}"]`).click()
const handle = (page: Page, key: string) => page.locator(`[data-resize-handle="${key}"]`)
const inputs = async (id: string) => (await stored('resizing')).features.find((f) => f.id === id)?.inputs

test.beforeEach(async ({ page }) => {
  await store(page, {
    id: 'resizing',
    version: 2,
    name: 'Resizing',
    features: [
      { feature: 'PageFeature', id: '1', inputs: { name: 'Page' }, placement: { parent: '$root', slot: 'content' } },
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

/** Presses on a handle and moves the mouse by (dx, dy) in steps, leaving the button down. */
async function pressAndMove(page: Page, key: string, dx: number, dy: number) {
  const box = (await handle(page, key).boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 8 })
}

test('drags a column edge to change the Column widths, as one undo step', async ({ page }) => {
  await select(page, '3')
  await expect(handle(page, 'edge-1')).toHaveAttribute('aria-valuetext', '1 : 1')
  const grid = (await feature(page, '3').boundingBox())!
  const edge = (await handle(page, 'edge-1').boundingBox())!
  // A third of the row further right: two thirds and one third.
  await pressAndMove(page, 'edge-1', grid.width / 6 + 2, 0)
  await expect(page.getByTestId('resize-value')).toHaveText('2 : 1')
  await page.mouse.up()
  await expect(handle(page, 'edge-1')).toHaveAttribute('aria-valuetext', '2 : 1')
  expect((await handle(page, 'edge-1').boundingBox())!.x).toBeGreaterThan(edge.x + grid.width / 8)
  // The page regenerated from the input; the selection is unchanged.
  await expect(page.getByTestId('inspector')).toContainText('Container #3')
  await expect.poll(async () => (await inputs('3'))?.column_widths).toBe('2, 1')
  const [left, right] = await Promise.all([feature(page, '4').boundingBox(), feature(page, '5').boundingBox()])
  expect(left!.width / right!.width).toBeCloseTo(2, 0)

  await page.getByTestId('undo').click()
  await expect(handle(page, 'edge-1')).toHaveAttribute('aria-valuetext', '1 : 1')
  await expect(page.getByTestId('undo')).toBeDisabled()
})

test('drags a banner taller in steps, and Escape puts the height back', async ({ page }) => {
  await select(page, '2')
  await expect(handle(page, 'height')).toHaveAttribute('aria-valuetext', 'Medium')
  // Responsive: the banner fills the width, so it has no width handle.
  await expect(handle(page, 'width')).toHaveCount(0)
  const banner = (await feature(page, '2').boundingBox())!

  // Short is a sixth of the width high, medium a quarter: well past the middle between them.
  await pressAndMove(page, 'height', 0, -banner.width / 16)
  await expect(page.getByTestId('resize-value')).toHaveText('Short')
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(handle(page, 'height')).toHaveAttribute('aria-valuetext', 'Medium')
  await expect(page.getByTestId('undo')).toBeDisabled()

  // Tall is 5/16 of the width high.
  await pressAndMove(page, 'height', 0, banner.width / 16)
  await page.mouse.up()
  await expect(handle(page, 'height')).toHaveAttribute('aria-valuetext', 'Tall')
  await expect.poll(async () => (await inputs('2'))?.banner_height).toBe('tall')
  const tall = (await feature(page, '2').boundingBox())!
  expect(tall.height).toBeCloseTo((tall.width * 5) / 16, 0)
})

test('moves a focused handle with the arrow keys', async ({ page }) => {
  await select(page, '2')
  await handle(page, 'height').focus()
  await page.keyboard.press('ArrowDown')
  await expect(handle(page, 'height')).toHaveAttribute('aria-valuetext', 'Short')
  await expect(handle(page, 'height')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(handle(page, 'height')).toHaveAttribute('aria-valuetext', 'Short')
  await expect.poll(async () => (await inputs('2'))?.banner_height).toBe('short')

  await select(page, '3')
  await handle(page, 'edge-1').focus()
  await page.keyboard.press('ArrowRight')
  await expect(handle(page, 'edge-1')).toHaveAttribute('aria-valuetext', '7 : 5')
  await expect.poll(async () => (await inputs('3'))?.column_widths).toBe('7, 5')
})

test('has no handles while text is edited in place, or for columns stacked at phone width', async ({ page }) => {
  await select(page, '3')
  await expect(handle(page, 'edge-1')).toBeVisible()
  await page.getByTestId('canvas-width-phone').click()
  await expect(handle(page, 'edge-1')).toHaveCount(0)
  await page.getByTestId('canvas-width-desktop').click()
  await expect(handle(page, 'edge-1')).toBeVisible()

  await select(page, '6')
  await expect(handle(page, 'height')).toHaveAttribute('aria-valuetext', 'Medium')
  await feature(page, '6').getByText('Find us').dblclick()
  await expect(canvas(page).locator('[contenteditable]')).toHaveCount(1)
  await expect(page.getByTestId('resize-handles')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(handle(page, 'height')).toBeVisible()
})
