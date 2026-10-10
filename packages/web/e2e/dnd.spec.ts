import { expect, test, type Locator, type Page } from '@playwright/test'
import { isolateNetwork } from './network'

// Drag-and-drop, undo/redo and keyboard moves, on fresh models. External requests are blocked.
isolateNetwork()

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('new-model').click()
  await expect(page.getByTestId('model-name')).toHaveValue('Untitled model')
})

const canvas = (page: Page) => page.getByTestId('canvas')
const tree = (page: Page) => page.getByTestId('feature-tree')
const feature = (page: Page, id: string) => canvas(page).locator(`[data-feature-id="${id}"]`)
const pageOrder = (page: Page, parent = '[data-feature-id="1"]') =>
  canvas(page).locator(`${parent} > [data-feature-id]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-feature-id')))

/** Drags with real mouse events (native HTML5 drag-and-drop), dropping near the top or bottom edge of the target. */
async function drag(page: Page, from: Locator, to: Locator, at: 'top' | 'bottom' | 'middle' = 'middle') {
  const box = (await to.boundingBox())!
  const y = at === 'top' ? 3 : at === 'bottom' ? box.height - 3 : box.height / 2
  await from.dragTo(to, { targetPosition: { x: box.width / 2, y } })
}

/** Adds features by clicking the palette with the page selected (each goes to the end of the page). */
async function addToPage(page: Page, ...types: string[]) {
  for (const type of types) {
    await tree(page).locator('[data-tree-id="1"]').click()
    await page.getByTestId(`palette-${type}`).click()
  }
}

test('drags a feature from the palette onto the page', async ({ page }) => {
  await drag(page, page.getByTestId('palette-HeaderFeature'), feature(page, '1'))
  await expect(feature(page, '2')).toHaveText('Your headline goes here')
  await expect(page.getByTestId('inspector')).toContainText('Header #2')
})

test('reorders features by dragging before and after each other', async ({ page }) => {
  await addToPage(page, 'TextFeature', 'HeaderFeature', 'ImageFeature')
  expect(await pageOrder(page)).toEqual(['2', '3', '4'])
  await drag(page, feature(page, '4'), feature(page, '2'), 'top')
  await expect.poll(() => pageOrder(page)).toEqual(['4', '2', '3'])
  await drag(page, feature(page, '4'), feature(page, '3'), 'bottom')
  await expect.poll(() => pageOrder(page)).toEqual(['2', '3', '4'])
})

test('drags features into container cells and panels', async ({ page }) => {
  await addToPage(page, 'ContainerFeature', 'TextFeature', 'PanelFeature')
  await drag(page, feature(page, '3'), canvas(page).locator('[data-node-id="2.r1c2"]'))
  await expect(canvas(page).locator('[data-node-id="2.r1c2"] > [data-feature-id="3"]')).toBeVisible()
  await drag(page, feature(page, '3'), feature(page, '4'))
  await expect(canvas(page).locator('[data-node-id="4.body"] > [data-feature-id="3"]')).toBeVisible()
  await expect(tree(page).locator('[role="treeitem"]:has(> div [data-tree-id="4"]) > [role="group"] [data-tree-id="3"]')).toBeVisible()
})

test('refuses to drop a container inside itself, explaining why', async ({ page }) => {
  await addToPage(page, 'ContainerFeature')
  const container = feature(page, '2')
  const cell = canvas(page).locator('[data-node-id="2.r1c2"]')
  const from = (await container.boundingBox())!
  const to = (await cell.boundingBox())!
  // Hover over the cell mid-drag to see the indicator, then drop.
  await page.mouse.move(from.x + 4, from.y + 4)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 })
  const indicator = page.getByTestId('drop-indicator')
  await expect(indicator).toHaveAttribute('data-allowed', 'false')
  await expect(indicator).toContainText('A feature cannot be placed inside itself')
  await page.mouse.up()
  await expect(indicator).toHaveCount(0)
  expect(await pageOrder(page)).toEqual(['2'])
  await expect(page.getByTestId('undo')).toBeEnabled()
  await page.getByTestId('undo').click()
  await expect(feature(page, '2')).toHaveCount(0)
})

test('reorders and nests features by dragging in the feature tree', async ({ page }) => {
  await addToPage(page, 'TextFeature', 'HeaderFeature', 'PanelFeature')
  const row = (id: string) => tree(page).locator(`[data-tree-id="${id}"]`)
  await drag(page, row('3'), row('2'), 'top')
  await expect.poll(() => pageOrder(page)).toEqual(['3', '2', '4'])
  await drag(page, row('2'), row('4'))
  await expect(canvas(page).locator('[data-node-id="4.body"] > [data-feature-id="2"]')).toBeVisible()
})

test('tree rows still drag after collapsing and expanding them', async ({ page }) => {
  await addToPage(page, 'TextFeature', 'HeaderFeature')
  const row = (id: string) => tree(page).locator(`[data-tree-id="${id}"]`)
  // Collapsing and expanding re-creates the rows; they must be draggable and accept drops again.
  await page.getByTestId('tree-toggle-1').click()
  await expect(row('2')).toHaveCount(0)
  await page.getByTestId('tree-toggle-1').click()
  await drag(page, row('3'), row('2'), 'top')
  await expect.poll(() => pageOrder(page)).toEqual(['3', '2'])
  await page.getByTestId('tree-toggle-all').click()
  await page.getByTestId('tree-toggle-all').click()
  await drag(page, row('2'), row('3'), 'top')
  await expect.poll(() => pageOrder(page)).toEqual(['2', '3'])
})

test('undoes and redoes with buttons and the keyboard', async ({ page }) => {
  await addToPage(page, 'TextFeature', 'HeaderFeature')
  await drag(page, feature(page, '3'), feature(page, '2'), 'top')
  await expect.poll(() => pageOrder(page)).toEqual(['3', '2'])

  await page.getByTestId('undo').click()
  await expect.poll(() => pageOrder(page)).toEqual(['2', '3'])
  await page.getByTestId('redo').click()
  await expect.poll(() => pageOrder(page)).toEqual(['3', '2'])

  await canvas(page).click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => pageOrder(page)).toEqual(['2', '3'])
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => pageOrder(page)).toEqual(['3', '2'])

  // In a text field, the shortcut is the field's own undo, not the model's: a model undo would make Redo available.
  await feature(page, '2').click()
  const text = page.getByTestId('inspector').getByLabel('Text', { exact: true })
  await text.fill('typed')
  await expect(page.getByTestId('redo')).toBeDisabled()
  await text.press('ControlOrMeta+z')
  await expect(page.getByTestId('redo')).toBeDisabled()
  await expect.poll(() => pageOrder(page)).toEqual(['3', '2'])
})

test('moves features up and down with the keyboard-friendly buttons', async ({ page }) => {
  await addToPage(page, 'TextFeature', 'HeaderFeature', 'ImageFeature')
  await tree(page).locator('[data-tree-id="2"]').click()
  await expect(page.getByTestId('move-up')).toBeDisabled()
  await page.getByTestId('move-down').click()
  await expect.poll(() => pageOrder(page)).toEqual(['3', '2', '4'])
  await page.getByTestId('move-down').click()
  await expect.poll(() => pageOrder(page)).toEqual(['3', '4', '2'])
  await expect(page.getByTestId('move-down')).toBeDisabled()
  await page.getByTestId('move-up').click()
  await expect.poll(() => pageOrder(page)).toEqual(['3', '2', '4'])
})

test('the undo shortcut works after using a select or checkbox, but not behind a dialog', async ({ page }) => {
  await addToPage(page, 'ContainerFeature', 'TextFeature')
  await tree(page).locator('[data-tree-id="3"]').click()
  const inspector = page.getByTestId('inspector')
  await inspector.getByLabel('Location').selectOption({ label: 'untitled › r1c1' })
  await expect(canvas(page).locator('[data-node-id="2.r1c1"] > [data-feature-id="3"]')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => pageOrder(page)).toEqual(['2', '3'])

  await inspector.getByLabel('Disable').check()
  await expect(feature(page, '3')).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(feature(page, '3')).toBeVisible()

  // Behind the dialog, the shortcut must do nothing (an undo here would remove the text added earlier).
  await inspector.getByTestId('delete-feature').click()
  await expect(page.getByTestId('confirm-dialog')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+z')
  await page.getByTestId('confirm-cancel').click()
  await expect.poll(() => pageOrder(page)).toEqual(['2', '3'])
})

test('drops near the edge of a page go into the page, not beside it', async ({ page }) => {
  await drag(page, page.getByTestId('palette-TextFeature'), feature(page, '1'), 'top')
  await expect(canvas(page).locator('[data-feature-id="1"] > [data-feature-id="2"]')).toBeVisible()
  await drag(page, page.getByTestId('palette-TextFeature'), feature(page, '1'), 'bottom')
  await expect.poll(() => pageOrder(page)).toEqual(['2', '3'])
  // Pages themselves can still be ordered at the document root (in the tree, where the page row has edges).
  await drag(page, page.getByTestId('palette-PageFeature'), tree(page).locator('[data-tree-id="1"]'), 'top')
  await expect.poll(() => canvas(page).locator('.fd-root > [data-feature-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-feature-id')))).toEqual(['4', '1'])
})

test('drags a feature that is not on the page from the tree onto the page', async ({ page }) => {
  await addToPage(page, 'TextFeature')
  // Break its placement in storage, then reload: it is listed under "Not on the page".
  await page.waitForTimeout(500)
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('feature-domain:models')!)
    const model = (Object.values(stored.models) as { name: string; features: { id: string; placement?: unknown }[] }[]).find((m) => m.name === 'Untitled model')!
    delete model.features.find((f) => f.id === '2')!.placement
    localStorage.setItem('feature-domain:models', JSON.stringify(stored))
  })
  await page.reload()
  await expect(tree(page).getByRole('tree', { name: 'Not on the page' }).locator('[data-tree-id="2"]')).toBeVisible()
  await drag(page, tree(page).locator('[data-tree-id="2"]'), feature(page, '1'))
  await expect(canvas(page).locator('[data-feature-id="1"] > [data-feature-id="2"]')).toBeVisible()
})

test('a drag that starts on a link inside a feature moves the feature', async ({ page }) => {
  await page.context().route('https://api.github.com/**', (route) => route.fulfill({ json: [{ name: 'engine', html_url: 'https://github.com/x/engine' }] }))
  await addToPage(page, 'TextFeature')
  await page.getByTestId('palette-DataResourceFeature').click()
  const inspector = page.getByTestId('inspector')
  await inspector.getByLabel('Resource URL').fill('https://api.github.com/users/x/repos')
  await tree(page).locator('[data-tree-id="1"]').click()
  await page.getByTestId('palette-TableFeature').click()
  await inspector.getByLabel('Data Resource').selectOption({ label: 'untitled (#3)' })
  await inspector.getByLabel('Fields').fill('name')
  await inspector.getByLabel('Filters').fill('dataLink :data.html_url')
  const link = feature(page, '4').getByRole('link', { name: 'engine' })
  await expect(link).toBeVisible()
  await drag(page, link, feature(page, '2'), 'top')
  await expect.poll(() => pageOrder(page)).toEqual(['4', '2'])
})
