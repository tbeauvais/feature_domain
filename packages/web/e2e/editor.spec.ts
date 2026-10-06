import { expect, test, type Page } from '@playwright/test'

// Editor flows on a fresh model. All external requests are blocked except a mocked GitHub API.
test.beforeEach(async ({ page }) => {
  await page.context().route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'localhost') return route.continue()
    if (url.hostname === 'api.github.com') return route.fulfill({ json: [{ name: 'engine', html_url: 'https://github.com/x/engine' }] })
    return route.abort()
  })
})

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
  await expect(heading).toHaveText('Enter your header text here')
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
  await inspector(page).getByLabel('Resource URL').fill('https://api.github.com/users/x/repos')
  await tree(page).locator('[data-tree-id="2"]').click()
  await inspector(page).getByLabel('Data Resource').selectOption({ label: 'untitled (#3)' })
  await inspector(page).getByLabel('Fields').fill('name')
  await expect(canvas(page).locator('[data-feature-id="2"] tbody td')).toHaveText(['engine'])
  // The resource is not on the page, so the tree lists it separately.
  await expect(tree(page).getByRole('tree', { name: 'Not on the page' })).toContainText('untitled')
})

test('the preview tab follows edits made in the editor', async ({ page, context }) => {
  await newModel(page)
  await page.getByTestId('palette-TextFeature').click()
  const [preview] = await Promise.all([context.waitForEvent('page'), page.getByTestId('open-preview').click()])
  await expect(preview.locator('[data-feature-id="2"]')).toHaveText('Lorem ipsum dolor sit amet, consectetur adipisicing elit')

  await inspector(page).getByLabel('Text', { exact: true }).fill('Updated in the editor')
  await expect(preview.locator('[data-feature-id="2"]')).toHaveText('Updated in the editor')
  await expect(preview.locator('.fd-placeholder')).toHaveCount(0)
})

test('creates and deletes models', async ({ page }) => {
  await newModel(page)
  await page.getByTestId('delete-model').click()
  await page.getByTestId('confirm-dialog').getByTestId('confirm-ok').click()
  await expect(page).toHaveURL('/')
  await expect(page.getByTestId('model-list').getByRole('link')).toHaveCount(5)
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

test('linking a table to a data resource keeps it where it is on the page', async ({ page }) => {
  await newModel(page)
  await page.getByTestId('palette-TableFeature').click()
  await tree(page).locator('[data-tree-id="1"]').click()
  await page.getByTestId('palette-TextFeature').click()
  await page.getByTestId('palette-DataResourceFeature').click()
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

test('leaving after a failed save asks before losing the changes', async ({ page }) => {
  await newModel(page)
  // Make browser storage refuse to save models.
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'feature-domain:models') throw new Error('QuotaExceededError')
      return setItem.call(this, key, value)
    }
  })
  await page.getByTestId('model-name').fill('Will not save')
  await expect(page.getByTestId('save-state')).toHaveText('Save failed')

  await page.getByRole('link', { name: 'Feature Domain' }).click()
  const dialog = page.getByTestId('confirm-dialog')
  await expect(dialog).toContainText('Your latest changes could not be saved (QuotaExceededError). Leave anyway and lose them?')
  await dialog.getByTestId('confirm-cancel').click()
  await expect(page).not.toHaveURL('/')
  await expect(page.getByTestId('model-name')).toHaveValue('Will not save')
})

test('a sample stored before List was ported is upgraded when opened', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('model-list')).toBeVisible()
  // Rewrite Data Sample's List the way it was stored before List was ported: scalar inputs, legacy instance in cache.
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('feature-domain:models')!)
    for (const model of Object.values(stored.models) as { name: string; features: { id: string; feature: string; inputs: object; cache?: object }[] }[]) {
      if (model.name !== 'Data Sample') continue
      const list = model.features.find((f) => f.id === '7')!
      const legacy = { feature: 'ListFeature', id: '7', inputs: { name: 'Color list', list: 'Red,Green,Blue,Yellow', align: 'center-block' } }
      list.inputs = { name: 'Color list', list: 'Red,Green,Blue,Yellow', align: 'center-block' }
      list.cache = { legacy }
    }
    localStorage.setItem('feature-domain:models', JSON.stringify(stored))
  })
  await page.getByRole('link', { name: 'Data Sample', exact: true }).click()
  await expect(canvas(page).locator('[data-feature-id="7"] li')).toHaveText(['Red', 'Green', 'Blue', 'Yellow'])
  await expect(page.getByTestId('save-state')).toHaveText('Saved')
  const saved = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('feature-domain:models')!)
    const model = (Object.values(stored.models) as { name: string; features: { id: string }[] }[]).find((m) => m.name === 'Data Sample')!
    return model.features.find((f) => f.id === '7')
  })
  expect(saved).toEqual({ feature: 'ListFeature', id: '7', inputs: { name: 'Color list', disable: false, items: ['Red', 'Green', 'Blue', 'Yellow'], align: 'center' }, placement: { parent: '12', slot: 'r1c1' } })
})

test('responsive images keep their aspect ratio in a narrow cell', async ({ page }) => {
  // The frog image in Data Sample is responsive, 300 x 300; serve it as a 2:1 picture.
  await page.context().route('http://assets.kompas.com/**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="green"/></svg>' }),
  )
  await page.goto('/')
  await page.getByRole('link', { name: 'Data Sample', exact: true }).click()
  await tree(page).locator('[data-tree-id="12"]').click()
  await inspector(page).getByLabel('Columns').fill('4')
  const frog = canvas(page).locator('[data-feature-id="13"]')
  await expect(frog).toHaveJSProperty('complete', true)
  const box = (await frog.boundingBox())!
  const cell = (await canvas(page).locator('[data-node-id="12.r1c2"]').boundingBox())!
  expect(box.width).toBeLessThanOrEqual(cell.width)
  expect(box.width).toBeLessThan(300)
  expect(box.height).toBeCloseTo(box.width / 2, 0)
})
