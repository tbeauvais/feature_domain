import { expect, test, type Page, type Route } from '@playwright/test'
import { isolateNetwork } from './network'
import { stored, storedId, store as storeModel } from './storage'

// Editor flows on a fresh model. All external requests are blocked except a mocked GitHub API (and Open-Meteo, mocked in the test that uses it).
isolateNetwork((route, url) => (url.hostname === 'api.github.com' ? route.fulfill({ json: [{ name: 'engine', html_url: 'https://github.com/x/engine' }] }) : undefined))

async function newModel(page: Page) {
  await page.goto('/')
  await page.getByTestId('new-model').click()
  await expect(page.getByTestId('model-name')).toHaveValue('Untitled model')
}

const canvas = (page: Page) => page.getByTestId('canvas')
const tree = (page: Page) => page.getByTestId('feature-tree')
const inspector = (page: Page) => page.getByTestId('inspector')

test('adds features from the palette, edits them live, and saves', async ({ page }) => {
  await newModel(page)
  await page.getByTestId('palette-HeaderFeature').click()
  const heading = canvas(page).locator('[data-feature-id="2"]')
  await expect(heading).toHaveText('Your headline goes here')
  await expect(tree(page).getByRole('treeitem', { selected: true })).toContainText('untitled')

  await inspector(page).getByLabel('Text', { exact: true }).fill('Hello parametric world')
  await inspector(page).getByLabel('Size').fill('2')
  await expect(heading).toHaveText('Hello parametric world')
  await expect(heading).toHaveJSProperty('tagName', 'H2')

  await page.getByTestId('model-name').fill('My model')
  await expect(page.getByTestId('save-state')).toHaveText('Saved')
  await page.reload()
  await expect(page.getByTestId('model-name')).toHaveValue('My model')
  await expect(canvas(page).locator('[data-feature-id="2"]')).toHaveText('Hello parametric world')
})

test('selects features by clicking the page or the tree, with an outline on the page', async ({ page }) => {
  await newModel(page)
  await page.getByTestId('palette-TextFeature').click()
  await page.getByTestId('palette-ImageFeature').click()
  await expect(inspector(page)).toContainText('Image #3')

  await canvas(page).locator('[data-feature-id="2"]').click()
  await expect(inspector(page)).toContainText('Text #2')
  await expect(tree(page).getByRole('treeitem', { selected: true })).toContainText('Text')
  const overlay = await page.getByTestId('selection-overlay').boundingBox()
  const text = await canvas(page).locator('[data-feature-id="2"]').boundingBox()
  expect(overlay).toEqual(text)

  await tree(page).locator('[data-tree-id="1"]').click()
  await expect(inspector(page)).toContainText('Page #1')
})

test('changing a container regenerates its cells, and features move between slots', async ({ page }) => {
  await newModel(page)
  await page.getByTestId('palette-ContainerFeature').click()
  await inspector(page).getByLabel('Columns').fill('3')
  await expect(canvas(page).locator('[data-feature-id="2"] > [data-slot]')).toHaveCount(3)

  // With the container selected, the palette adds into its first cell.
  await page.getByTestId('palette-TextFeature').click()
  await expect(canvas(page).locator('[data-node-id="2.r1c1"] [data-feature-id="3"]')).toBeVisible()
  await inspector(page).getByLabel('Location').selectOption({ label: 'untitled › r1c3' })
  await expect(canvas(page).locator('[data-node-id="2.r1c3"] [data-feature-id="3"]')).toBeVisible()
  await expect(tree(page).locator('[data-tree-id="3"]')).toContainText('r1c3')
})

test('deletes a feature with everything inside it, after confirming', async ({ page }) => {
  await newModel(page)
  await page.getByTestId('palette-PanelFeature').click()
  await page.getByTestId('palette-TextFeature').click()
  await tree(page).locator('[data-tree-id="2"]').click()

  await inspector(page).getByTestId('delete-feature').click()
  const dialog = page.getByTestId('confirm-dialog')
  await expect(dialog).toContainText('Delete "untitled"?')
  await expect(dialog).toContainText('1 feature(s) inside it will be deleted too.')
  await dialog.getByTestId('confirm-ok').click()
  await expect(canvas(page).locator('[data-feature-id="2"], [data-feature-id="3"]')).toHaveCount(0)
  await expect(inspector(page)).toContainText('Select a feature')
})

test('a table shows what it needs until it gets a data resource', async ({ page }) => {
  await newModel(page)
  await page.getByTestId('palette-TableFeature').click()
  await expect(canvas(page).locator('.fd-placeholder[data-feature-id="2"]')).toContainText('No Data Resource selected')
  await expect(tree(page).locator('[data-tree-id="2"]')).toContainText('skipped')

  await page.getByTestId('palette-DataResourceFeature').click()
  // New data resources start on sample rows; these tests fetch the (mocked) GitHub API instead.
  await inspector(page).getByRole('button', { name: 'Address' }).click()
  await inspector(page).getByLabel('Resource URL').fill('https://api.github.com/users/x/repos')
  await tree(page).locator('[data-tree-id="2"]').click()
  await inspector(page).getByLabel('Data Resource').selectOption({ label: 'untitled (#3)' })
  await inspector(page).getByLabel('Fields').fill('name')
  await expect(canvas(page).locator('[data-feature-id="2"] tbody td')).toHaveText(['engine'])
  // Resources are never placed, so the tree lists them in their own section (not as a problem).
  await expect(tree(page).getByRole('tree', { name: 'Resources and themes' })).toContainText('untitled')
  await expect(tree(page).getByRole('tree', { name: 'Not on the page' })).toHaveCount(0)
})

test('the preview tab follows edits made in the editor', async ({ page, context }) => {
  await newModel(page)
  await page.getByTestId('palette-TextFeature').click()
  const [preview] = await Promise.all([context.waitForEvent('page'), page.getByTestId('open-preview').click()])
  await expect(preview.locator('[data-feature-id="2"]')).toHaveText('Say what this part of the page is about in a sentence or two.')

  await inspector(page).getByLabel('Text', { exact: true }).fill('Updated in the editor')
  await expect(preview.locator('[data-feature-id="2"]')).toHaveText('Updated in the editor')
  await expect(preview.locator('.fd-placeholder')).toHaveCount(0)
})

test('creates and deletes models', async ({ page }) => {
  await newModel(page)
  await page.getByTestId('delete-model').click()
  await page.getByTestId('confirm-dialog').getByTestId('confirm-ok').click()
  await expect(page).toHaveURL('/')
  await expect(page.getByTestId('model-list').getByRole('link')).toHaveCount(6)
})

test('typing into list and number fields keeps what you type', async ({ page }) => {
  await newModel(page)
  await page.getByTestId('palette-ListFeature').click()
  const items = inspector(page).getByLabel('List Items')
  await items.click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('\nNew York')
  await expect(items).toHaveValue('Red\nGreen\nBlue\nNew York')
  await expect(canvas(page).locator('[data-feature-id="2"] li')).toHaveText(['Red', 'Green', 'Blue', 'New York'])

  await page.getByTestId('palette-ContainerFeature').click()
  const columns = inspector(page).getByLabel('Columns')
  await columns.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('3')
  await expect(columns).toHaveValue('3')
  await expect(canvas(page).locator('[data-feature-id="3"] > [data-slot]')).toHaveCount(3)
})

test('a new data resource serves sample rows, so a table on it shows data at once and follows edits', async ({ page }) => {
  await newModel(page)
  await page.getByTestId('palette-TableFeature').click()
  await page.getByTestId('palette-DataResourceFeature').click()
  await expect(inspector(page).getByRole('button', { name: 'Sample data' })).toHaveAttribute('aria-pressed', 'true')
  await expect(inspector(page).getByLabel('Resource URL')).toHaveCount(0)
  await tree(page).locator('[data-tree-id="2"]').click()
  await inspector(page).getByLabel('Data Resource').selectOption({ label: 'untitled (#3)' })
  const table = canvas(page).locator('[data-feature-id="2"]')
  await expect(table.locator('th')).toHaveText(['Name', 'Role', 'City', 'Projects'])
  await expect(table.locator('tbody tr')).toHaveCount(3)
  await expect(table.locator('tbody tr').first().locator('td').first()).toHaveText('Ada Lovelace')

  // Editing the rows updates the table; a mistake is reported, not thrown.
  await tree(page).locator('[data-tree-id="3"]').click()
  await inspector(page).getByLabel('Sample rows (JSON)').fill('[{"name": "Linus", "os": "Linux"}]')
  await expect(table.locator('th')).toHaveText(['Name', 'Os'])
  await expect(table.locator('tbody td')).toHaveText(['Linus', 'Linux'])
  await inspector(page).getByLabel('Sample rows (JSON)').fill('[{"name": ')
  await expect(inspector(page)).toContainText('Sample rows are not valid JSON')
})

test('linking a table to a data resource keeps it where it is on the page', async ({ page }) => {
  await newModel(page)
  await page.getByTestId('palette-TableFeature').click()
  await tree(page).locator('[data-tree-id="1"]').click()
  await page.getByTestId('palette-TextFeature').click()
  await page.getByTestId('palette-DataResourceFeature').click()
  // New data resources start on sample rows; these tests fetch the (mocked) GitHub API instead.
  await inspector(page).getByRole('button', { name: 'Address' }).click()
  await inspector(page).getByLabel('Resource URL').fill('https://api.github.com/users/x/repos')
  await tree(page).locator('[data-tree-id="2"]').click()
  await inspector(page).getByLabel('Data Resource').selectOption({ label: 'untitled (#4)' })
  await expect(canvas(page).locator('[data-feature-id="1"] > [data-feature-id]')).toHaveCount(2)
  const order = await canvas(page).locator('[data-feature-id="1"] > [data-feature-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-feature-id')))
  expect(order).toEqual(['2', '3'])
})

test('the selection outline follows content that loads later', async ({ page }) => {
  await page.context().route('https://api.github.com/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400))
    await route.fulfill({ json: Array.from({ length: 8 }, (_, i) => ({ name: `repo ${i}` })) })
  })
  await newModel(page)
  await page.getByTestId('palette-DataResourceFeature').click()
  // New data resources start on sample rows; these tests fetch the (mocked) GitHub API instead.
  await inspector(page).getByRole('button', { name: 'Address' }).click()
  await inspector(page).getByLabel('Resource URL').fill('https://api.github.com/users/x/repos')
  await page.getByTestId('palette-TableFeature').click()
  await inspector(page).getByLabel('Data Resource').selectOption({ label: 'untitled (#2)' })
  await inspector(page).getByLabel('Fields').fill('name')
  const table = canvas(page).locator('[data-feature-id="3"]')
  await expect(table.locator('tbody tr')).toHaveCount(8)
  await expect(async () => {
    expect((await page.getByTestId('selection-overlay').boundingBox())?.height).toBeCloseTo((await table.boundingBox())!.height, 0)
  }).toPass()
})

test('leaving after a failed save asks before losing the changes, and Try again saves them', async ({ page }) => {
  await newModel(page)
  // The server fails every save.
  const failing = (route: Route) => (route.request().method() === 'PUT' ? route.fulfill({ status: 503, json: { error: 'Something went wrong on the server' } }) : route.fallback())
  await page.route('**/api/v1/models/*', failing)
  await page.getByTestId('model-name').fill('Will not save')
  await expect(page.getByTestId('save-state')).toHaveText('Save failed')
  await expect(page.getByTestId('save-problem')).toContainText('Your latest changes could not be saved: Something went wrong on the server.')

  await page.getByRole('link', { name: 'Feature Domain' }).click()
  const dialog = page.getByTestId('confirm-dialog')
  await expect(dialog).toContainText('Your latest changes could not be saved (Something went wrong on the server). Leave anyway and lose them?')
  await dialog.getByTestId('confirm-cancel').click()
  await expect(page).not.toHaveURL('/')
  await expect(page.getByTestId('model-name')).toHaveValue('Will not save')

  await page.unroute('**/api/v1/models/*', failing)
  await page.getByTestId('retry-save').click()
  await expect(page.getByTestId('save-state')).toHaveText('Saved')
  await expect(page.getByTestId('save-problem')).toHaveCount(0)
  expect((await stored(await storedId('Will not save'))).name).toBe('Will not save')
})

test('a save refused because the sign-in expired says how to sign in again without losing the edits', async ({ page }) => {
  await newModel(page)
  // Cloudflare Access answers an expired session with a redirect to its sign-in page.
  const signedOut = (route: Route) =>
    route.request().method() === 'PUT' ? route.fulfill({ status: 302, headers: { Location: 'https://feature-domain.cloudflareaccess.com/cdn-cgi/access/login' } }) : route.fallback()
  await page.route('**/api/v1/models/*', signedOut)
  await page.getByTestId('model-name').fill('After sign-in')
  const banner = page.getByTestId('save-problem')
  await expect(banner).toContainText('Your sign-in has expired, so your latest changes are not saved.')
  await expect(banner.getByTestId('sign-in-again')).toHaveAttribute('target', '_blank')
  await page.unroute('**/api/v1/models/*', signedOut)
  await banner.getByTestId('retry-save').click()
  await expect(page.getByTestId('save-state')).toHaveText('Saved')
  expect((await stored(await storedId('After sign-in'))).name).toBe('After sign-in')
})

/** Stores a model in the test's model API, after the home page has loaded. */
async function store(page: Page, model: { id: string; [key: string]: unknown }) {
  await page.goto('/')
  await expect(page.getByTestId('model-list')).toBeVisible()
  await storeModel(page, model)
}

test('a model stored before List was ported is upgraded when opened', async ({ page }) => {
  // A List the way it was stored before List was ported: scalar inputs, its legacy instance in cache.
  const legacy = { feature: 'ListFeature', id: '2', inputs: { name: 'Color list', list: 'Red,Green,Blue,Yellow', align: 'center-block' } }
  await store(page, {
    id: 'stored-list',
    version: 2,
    name: 'Stored list',
    features: [
      { feature: 'PageFeature', id: '1', inputs: { name: 'Page' }, placement: { parent: '$root', slot: 'content' } },
      { feature: 'ListFeature', id: '2', inputs: { ...legacy.inputs }, placement: { parent: '1', slot: 'content' }, cache: { legacy } },
    ],
  } as { id: string })
  await page.goto('/models/stored-list')
  await expect(canvas(page).locator('[data-feature-id="2"] li')).toHaveText(['Red', 'Green', 'Blue', 'Yellow'])
  await expect(page.getByTestId('save-state')).toHaveText('Saved')
  const saved = (await stored('stored-list')).features[1]
  expect(saved).toEqual({ feature: 'ListFeature', id: '2', inputs: { name: 'Color list', disable: false, items: ['Red', 'Green', 'Blue', 'Yellow'], align: 'center' }, placement: { parent: '1', slot: 'content' } })
})

test('responsive images keep their aspect ratio in a narrow cell', async ({ page }) => {
  // A responsive 300 x 300 image, served as a 2:1 picture.
  await page.context().route('https://images.test/**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="green"/></svg>' }),
  )
  await store(page, {
    id: 'picture',
    version: 2,
    name: 'Picture',
    features: [
      { feature: 'PageFeature', id: '1', inputs: { name: 'Page' }, placement: { parent: '$root', slot: 'content' } },
      { feature: 'ContainerFeature', id: '2', inputs: { rows: 1, columns: 2 }, placement: { parent: '1', slot: 'content' } },
      { feature: 'ImageFeature', id: '3', inputs: { source: 'link', src: 'https://images.test/picture.svg', alt: 'A green field', responsive: true, width: '300', height: '300' }, placement: { parent: '2', slot: 'r1c2' } },
    ],
  } as { id: string })
  await page.goto('/models/picture')
  await tree(page).locator('[data-tree-id="2"]').click()
  await inspector(page).getByLabel('Columns').fill('4')
  const image = canvas(page).locator('[data-feature-id="3"]')
  await expect(image).toHaveJSProperty('complete', true)
  const box = (await image.boundingBox())!
  const cell = (await canvas(page).locator('[data-node-id="2.r1c2"]').boundingBox())!
  expect(box.width).toBeLessThanOrEqual(cell.width)
  expect(box.width).toBeLessThan(300)
  expect(box.height).toBeCloseTo(box.width / 2, 0)
})

test('deleting a model with an unsaved edit goes straight back to the list', async ({ page }) => {
  await newModel(page)
  await page.getByTestId('model-name').fill('Renamed just now')
  await page.getByTestId('delete-model').click()
  await page.getByTestId('confirm-dialog').getByTestId('confirm-ok').click()
  await expect(page).toHaveURL('/')
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0)
  await expect(page.getByTestId('model-list').getByRole('link')).toHaveCount(6)
})

test('the editor and preview load nothing from other sites', async ({ page, context }) => {
  const external: string[] = []
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'localhost') return route.continue()
    external.push(url.href)
    return route.abort()
  })
  await page.goto('/')
  await page.getByTestId('new-model').click()
  await page.getByTestId('palette-TextFeature').click()
  await page.getByTestId('open-preview').click()
  await page.waitForLoadState('networkidle')
  expect(external).toEqual([])
})

test('adding a Theme restyles the page at once, and its settings drive the preview', async ({ page, context }) => {
  await newModel(page)
  await page.getByTestId('palette-HeaderFeature').click()
  const root = page.getByTestId('canvas').locator('.fd-root')
  await expect(root).toHaveAttribute('data-fd-scheme', 'light')

  await page.getByTestId('palette-ThemeFeature').click()
  const scheme = inspector(page).getByRole('group', { name: 'Scheme' })
  await expect(scheme.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true')
  await scheme.getByRole('button', { name: 'Dark' }).click()
  await expect(root).toHaveAttribute('data-fd-scheme', 'dark')
  const darkBg = await root.evaluate((el) => getComputedStyle(el).backgroundColor)
  // A dark scheme paints a dark background: every channel well below mid-gray.
  expect(darkBg.match(/\d+/g)!.slice(0, 3).map(Number).every((channel) => channel < 64), darkBg).toBe(true)

  const [preview] = await Promise.all([context.waitForEvent('page'), page.getByTestId('open-preview').click()])
  await expect(preview.locator('.fd-root')).toHaveAttribute('data-fd-scheme', 'dark')
  await expect.poll(() => preview.locator('.fd-root').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(darkBg)

  // Undo the scheme change, then the Theme itself: the page goes back to the default theme.
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(root).toHaveAttribute('data-fd-scheme', 'light')
  await expect(tree(page).getByRole('tree', { name: 'Resources and themes' }).locator('[data-tree-id="3"]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(tree(page).locator('[data-tree-id="3"]')).toHaveCount(0)
  await expect(root).toHaveAttribute('data-fd-scheme', 'light')
})

test('the canvas shows the page at desktop, tablet and phone widths, and remembers the choice', async ({ page }) => {
  await newModel(page)
  await page.getByTestId('palette-ContainerFeature').click()
  // An empty container keeps its space below in the editor (the page itself collapses it), so its drop cells stand apart.
  const marginBottom = await canvas(page).locator('[data-feature-id="2"]').evaluate((el) => parseFloat(getComputedStyle(el).marginBottom))
  expect(marginBottom).toBeGreaterThan(20)
  const cells = canvas(page).locator('[data-node-id="2.r1c1"], [data-node-id="2.r1c2"]')
  const tops = async () => Promise.all((await cells.all()).map(async (c) => (await c.boundingBox())!.y))

  // Side by side on desktop...
  let [first, second] = await tops()
  expect(first).toBe(second)
  // ...stacked at phone width, because the page sizes itself from its own width.
  await page.getByTestId('canvas-width-phone').click()
  await expect(canvas(page)).toHaveAttribute('data-canvas-width', 'phone')
  expect((await canvas(page).boundingBox())!.width).toBeLessThanOrEqual(390)
  ;[first, second] = await tops()
  expect(second).toBeGreaterThan(first!)

  // Tablet is 820px wide even when the window leaves less room (the canvas scrolls sideways).
  await page.getByTestId('canvas-width-tablet').click()
  expect((await canvas(page).boundingBox())!.width).toBe(820)
  ;[first, second] = await tops()
  expect(first).toBe(second)

  await page.getByTestId('canvas-width-phone').click()
  await page.reload()
  await expect(canvas(page)).toHaveAttribute('data-canvas-width', 'phone')
  await page.getByTestId('canvas-width-desktop').click()
})

test('on a short window the feature tree stays usable, and the palette folds away', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 })
  await newModel(page)
  for (let i = 0; i < 8; i++) await page.getByTestId('palette-TextFeature').click()
  const lastRow = tree(page).locator('[data-tree-id="9"]')
  await lastRow.scrollIntoViewIfNeeded()
  await lastRow.click()
  await expect(inspector(page)).toContainText('Text #9')
  expect((await tree(page).boundingBox())!.height).toBeGreaterThan(150)

  await page.getByTestId('palette-toggle').click()
  await expect(page.getByTestId('palette-TextFeature')).toBeHidden()
  await page.reload()
  await expect(page.getByTestId('palette-TextFeature')).toBeHidden()
  await page.getByTestId('palette-toggle').click()
  await expect(page.getByTestId('palette-TextFeature')).toBeVisible()
})

test('the status bar opens the problems list, and ? shows the keyboard shortcuts', async ({ page }) => {
  await newModel(page)
  await page.getByTestId('palette-TableFeature').click()
  await expect(page.getByTestId('problems-toggle')).toHaveText('1 problem')
  await expect(page.getByTestId('status-counts')).toHaveText('2 features · 0 data resources · 0 themes')
  await page.getByTestId('problems-toggle').click()
  // (The inspector lists the selected table's own problems too; this is the model-wide list.)
  const panel = page.locator('#problems-panel')
  await expect(panel.getByTestId('diagnostics')).toContainText('No Data Resource selected')
  await page.getByTestId('problems-toggle').click()
  await expect(panel).toHaveCount(0)

  await page.getByTestId('canvas').click()
  await page.keyboard.press('?')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeHidden()
  // Typing ? into a text field types it (real key presses, so the shortcut handler sees them).
  await page.getByTestId('model-name').click()
  await page.keyboard.press('End')
  await page.keyboard.type('?')
  await expect(page.getByTestId('model-name')).toHaveValue('Untitled model?')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeHidden()

  // While the shortcuts are open, undo doesn't act behind them.
  await page.getByTestId('canvas').click()
  await page.keyboard.press('?')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.getByTestId('model-name')).toHaveValue('Untitled model?')
  await page.keyboard.press('Escape')
})

test('buttons keep their colors on hover, in every style', async ({ page }) => {
  await newModel(page)
  const styles = ['primary', 'secondary', 'soft', 'link']
  for (const [index, style] of styles.entries()) {
    await page.getByTestId('palette-ButtonFeature').click()
    await inspector(page).getByLabel('Style').selectOption(style)
    await expect(canvas(page).locator(`[data-feature-id="${index + 2}"] .fd-button-${style}`)).toBeVisible()
  }
  for (const [index, style] of styles.entries()) {
    const button = canvas(page).locator(`[data-feature-id="${index + 2}"] a`)
    const color = () => button.evaluate((el) => getComputedStyle(el).color)
    await page.mouse.move(0, 0)
    const before = await color()
    await button.hover()
    // Links may change on hover; filled and outlined buttons must not (accent text on an accent fill was unreadable).
    if (style !== 'link') expect(await color(), style).toBe(before)
  }
})

test('a new model guides the first steps, and a theme starts from a built-in one', async ({ page }) => {
  await newModel(page)
  // The empty page says what to do, and quick-adds a first feature.
  const hint = canvas(page).getByTestId('empty-page-hint')
  await expect(hint).toContainText('This page is empty')
  await expect(inspector(page)).toContainText('1 page · nothing on it yet')
  await hint.getByRole('button', { name: 'Header' }).click()
  await expect(hint).toHaveCount(0)
  await expect(canvas(page).locator('.fd-heading')).toHaveText('Your headline goes here')

  // A new theme is used by the page at once and starts as Warm Editorial.
  await page.getByTestId('palette-ThemeFeature').click()
  await expect(inspector(page).getByTestId('used-by-summary')).toHaveText('used by 1 page')
  await expect(inspector(page).locator('[data-preset="warm-editorial"]')).toHaveAttribute('aria-pressed', 'true')

  // Night Garden restyles the page at once and renames the theme; one undo puts it all back.
  await inspector(page).locator('[data-preset="night-garden"]').click()
  await expect(canvas(page).locator('.fd-page')).toHaveAttribute('data-fd-scheme', 'dark')
  await expect(inspector(page).getByLabel('Name')).toHaveValue('Night Garden')
  await expect(page.getByTestId('theme-summary')).toContainText('Night Garden')
  await page.getByTestId('undo').click()
  await expect(canvas(page).locator('.fd-page')).toHaveAttribute('data-fd-scheme', 'light')
  await expect(inspector(page).getByLabel('Name')).toHaveValue('Warm Editorial')

  // Used by selects the page.
  await inspector(page).locator('[data-used-by="1"]').click()
  await expect(inspector(page)).toContainText('Page #1')
})

test('an API spec loads from its URL, offers its operations, and can answer with sample rows', async ({ page }) => {
  const spec = {
    openapi: '3.1.0',
    info: { title: 'Pets' },
    servers: [{ url: 'https://pets.test' }],
    components: { schemas: { Pet: { type: 'object', properties: { name: { type: 'string', description: 'Name' }, kind: { type: 'string', description: 'Kind' } } } } },
    paths: { '/pets': { get: { summary: 'List pets', responses: { '200': { content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } } } } } } } } },
  }
  await page.context().route('https://pets.test/**', (route) => route.fulfill({ json: route.request().url().endsWith('openapi.json') ? spec : [{ name: 'Rex', kind: 'dog' }] }))
  await newModel(page)
  await page.getByTestId('palette-TableFeature').click()
  await page.getByTestId('palette-SwaggerDataResourceFeature').click()
  await inspector(page).getByLabel('Spec URL').fill('https://pets.test/openapi.json')
  await inspector(page).getByTestId('load-spec').click()
  await expect(inspector(page).getByTestId('api-spec-summary')).toHaveText('OpenAPI 3.1.0 · Pets · 1 operation')

  await tree(page).locator('[data-tree-id="2"]').click()
  await inspector(page).getByLabel('Data Resource').selectOption({ label: 'untitled (#3)' })
  await inspector(page).getByLabel('Operation', { exact: true }).selectOption('GET /pets')
  const table = canvas(page).locator('[data-feature-id="2"]')
  await expect(table.locator('th')).toHaveText(['Name', 'Kind'])
  await expect(table.locator('tbody td')).toHaveText(['Rex', 'dog'])

  // With sample data the same table answers from the rows, fetching nothing.
  await tree(page).locator('[data-tree-id="3"]').click()
  await inspector(page).getByRole('button', { name: 'Sample data' }).click()
  await inspector(page).getByLabel('Sample rows (JSON)').fill('[{"name": "Tom", "kind": "cat"}]')
  await expect(table.locator('tbody td')).toHaveText(['Tom', 'cat'])
})

test('a chart draws a data resource\'s rows in the theme\'s colors, and follows its type and data', async ({ page }) => {
  await newModel(page)
  await page.getByTestId('palette-GoogleChartFeature').click()
  await page.getByTestId('palette-DataResourceFeature').click()
  await tree(page).locator('[data-tree-id="2"]').click()
  await inspector(page).getByLabel('Data Resource').selectOption({ label: 'untitled (#3)' })
  const chart = canvas(page).locator('[data-feature-id="2"]')
  const drawn = chart.locator('canvas')
  // A new resource's example rows chart at once: projects by name.
  await expect(drawn).toBeVisible()
  await expect(drawn).toHaveAttribute('aria-label', 'column chart of projects by name')
  await tree(page).locator('[data-tree-id="3"]').click()
  await inspector(page).getByLabel('Sample rows (JSON)').fill('[{"region": "North", "sales": 5}, {"region": "South", "sales": 3}]')
  await expect(drawn).toHaveAttribute('aria-label', 'column chart of sales by region')
  // Something was actually drawn on the canvas, in the accent color.
  const painted = async () =>
    drawn.evaluate((c: HTMLCanvasElement) => {
      const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
      let colored = 0
      for (let i = 0; i < data.length; i += 4) if (data[i + 3]! > 200 && Math.max(data[i]!, data[i + 1]!, data[i + 2]!) - Math.min(data[i]!, data[i + 1]!, data[i + 2]!) > 60) colored++
      return colored
    })
  await expect.poll(painted).toBeGreaterThan(500)
  await tree(page).locator('[data-tree-id="2"]').click()
  await inspector(page).getByRole('button', { name: 'Donut' }).click()
  await expect(drawn).toHaveAttribute('aria-label', 'donut chart of sales by region')
  await expect(chart.locator('.fd-visually-hidden tbody tr')).toHaveText(['North5', 'South3'])
})

test('a Weather card shows the forecast for its place, and Find moves it somewhere else', async ({ page, context }) => {
  // Open-Meteo, mocked: the forecast's temperature follows the latitude asked for, so a new place shows new figures.
  const asked: string[] = []
  await page.context().route('https://api.open-meteo.com/**', (route) => {
    const url = new URL(route.request().url())
    asked.push(url.search)
    const warm = url.searchParams.get('latitude') === '43.6615' ? 1 : 0
    return route.fulfill({
      json: {
        current_units: { temperature_2m: url.searchParams.get('temperature_unit') === 'celsius' ? '°C' : '°F' },
        current: { temperature_2m: 61.6 + warm * 10, weather_code: 3, is_day: 1 },
        daily: { time: ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14'], weather_code: [3, 0, 61, 71], temperature_2m_max: [64, 66, 59, 41], temperature_2m_min: [50, 52, 48, 30] },
      },
    })
  })
  await page.context().route('https://geocoding-api.open-meteo.com/**', (route) =>
    route.fulfill({ json: { results: [{ name: 'Portland', latitude: 43.66147, longitude: -70.25533, country: 'United States', admin1: 'Maine' }] } }),
  )
  await newModel(page)
  await page.getByTestId('palette-WeatherFeature').click()
  const card = canvas(page).locator('[data-feature-id="2"]')
  await expect(card.getByRole('heading')).toHaveText('Guilford, Connecticut')
  await expect(card.locator('.fd-weather-temp')).toHaveText('62°F')
  await expect(card.locator('.fd-weather-text')).toHaveText('Overcast')
  await expect(card.locator('.fd-weather-day-name')).toHaveText(['Mon', 'Tue', 'Wed'])
  await expect(card.getByRole('link', { name: 'Weather data by Open-Meteo.com' })).toHaveAttribute('href', 'https://open-meteo.com/')

  await inspector(page).getByLabel('Find a place').fill('Portland')
  await inspector(page).getByLabel('Find a place').press('Enter')
  await inspector(page).getByRole('button', { name: /Portland, Maine/ }).click()
  await expect(card.getByRole('heading')).toHaveText('Portland, Maine')
  await expect(card.locator('.fd-weather-temp')).toHaveText('72°F')
  await expect(inspector(page).getByLabel('Latitude')).toHaveValue('43.6615')

  await inspector(page).getByRole('button', { name: '°C' }).click()
  await inspector(page).getByRole('button', { name: 'Now', exact: true }).click()
  await expect(card.locator('.fd-weather-temp')).toHaveText('72°C')
  await expect(card.locator('.fd-weather-days')).toHaveCount(0)
  expect(asked.at(-1)).toContain('temperature_unit=celsius')
  expect(asked.at(-1)).not.toContain('daily=')

  // The preview fetches the same forecast.
  const id = decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!)
  await expect(page.getByTestId('save-state')).toHaveText(/Saved/)
  const preview = await context.newPage()
  await preview.goto(`/preview.html?model=${encodeURIComponent(id)}`)
  await expect(preview.locator('.fd-weather-temp')).toHaveText('72°C')
})

test('edits text in place on the canvas: a header, a list item and a paragraph', async ({ page }) => {
  await newModel(page)
  await page.getByTestId('palette-HeaderFeature').click()
  const heading = canvas(page).locator('[data-feature-id="2"]')

  // Double-click, type over the selected text, Enter keeps it; the inspector follows.
  await heading.dblclick()
  await expect(heading).toHaveAttribute('contenteditable', 'plaintext-only')
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Built from features')
  await page.keyboard.press('Enter')
  await expect(heading).toHaveText('Built from features')
  await expect(heading).not.toHaveAttribute('contenteditable')
  await expect(inspector(page).getByLabel('Text', { exact: true })).toHaveValue('Built from features')
  // One undo step puts it back.
  await page.getByTestId('undo').click()
  await expect(heading).toHaveText('Your headline goes here')
  await page.getByTestId('redo').click()

  // Enter on a selected feature edits it too; Escape puts the text back.
  await heading.click()
  await page.keyboard.press('Enter')
  await expect(heading).toHaveAttribute('contenteditable', 'plaintext-only')
  await page.keyboard.type('Discarded')
  await page.keyboard.press('Escape')
  await expect(heading).toHaveText('Built from features')

  // A list: Enter adds the next item and edits it.
  await page.getByTestId('palette-ListFeature').click()
  const items = canvas(page).locator('[data-feature-id="3"] li')
  await items.nth(1).dblclick()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Teal')
  await page.keyboard.press('Enter')
  await expect(items.nth(2)).toHaveAttribute('contenteditable', 'plaintext-only')
  await page.keyboard.type('Violet')
  await page.getByTestId('model-name').click()
  await expect(items).toHaveText(['Red', 'Teal', 'Violet', 'Blue'])
  await expect(inspector(page).getByLabel('List Items')).toHaveValue('Red\nTeal\nViolet\nBlue')

  // A paragraph of Text with title, left by clicking elsewhere; the change is saved.
  await canvas(page).locator('[data-feature-id="2"]').click()
  await page.getByTestId('palette-TextWithParagraphFeature').click()
  const paragraph = canvas(page).locator('[data-node-id="4.p1"]')
  await paragraph.dblclick()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Written on the page.')
  await page.getByTestId('model-name').click()
  await expect(paragraph).toHaveText('Written on the page.')
  await expect(page.getByTestId('save-state')).toHaveText('Saved')
  await page.reload()
  await expect(canvas(page).locator('[data-node-id="4.p1"]')).toHaveText('Written on the page.')
  await expect(canvas(page).locator('[data-feature-id="3"] li')).toHaveText(['Red', 'Teal', 'Violet', 'Blue'])
})

test('the preview has no inline editing', async ({ page }) => {
  await newModel(page)
  await page.getByTestId('palette-HeaderFeature').click()
  await expect(canvas(page).locator('[data-edit]')).toHaveCount(1)
  const id = new URL(page.url()).pathname.split('/').pop()!
  await expect(page.getByTestId('save-state')).toHaveText('Saved')
  await page.goto(`/preview.html?model=${id}`)
  const heading = page.locator('h1')
  await expect(heading).toHaveText('Your headline goes here')
  await heading.dblclick()
  await expect(page.locator('[data-edit], [contenteditable]')).toHaveCount(0)
})

test('Enter edits the selected feature’s text from its tree row, but not from inspector fields', async ({ page }) => {
  await newModel(page)
  await page.getByTestId('palette-HeaderFeature').click()
  const heading = canvas(page).locator('[data-feature-id="2"]')

  // In an inspector field, Enter is the field's own.
  await inspector(page).getByLabel('Text', { exact: true }).press('Enter')
  await expect(page.locator('[contenteditable]')).toHaveCount(0)

  // From the selected feature's row in the tree, Enter edits its text on the page.
  await tree(page).locator('[data-tree-id="2"]').focus()
  await page.keyboard.press('Enter')
  await expect(heading).toHaveAttribute('contenteditable', 'plaintext-only')
  await expect(heading).toBeFocused()
  await page.keyboard.type('From the keyboard')
  await page.keyboard.press('Enter')
  await expect(heading).toHaveText('From the keyboard')

  // A row that isn't selected just selects its feature.
  await tree(page).locator('[data-tree-id="1"]').focus()
  await page.keyboard.press('Enter')
  await expect(inspector(page)).toContainText('Page #1')
  await expect(page.locator('[contenteditable]')).toHaveCount(0)
})
