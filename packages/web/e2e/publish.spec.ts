import { expect, test, type Page } from '@playwright/test'
import { isolateNetwork } from './network'
import { changeStored, publishStored, storedId } from './storage'

// A published app at <slug>.localhost (the Worker's app host; its API here over the test's own stores): the Team
// requests sample, published, keeps rows of its own apart from the draft's, and keeps them when published again.
isolateNetwork()

async function fileRequest(page: Page, title: string): Promise<void> {
  await page.getByLabel('What do you need?').fill(title)
  await page.getByLabel(/^Your name/).fill('Ana Ruiz')
  await page.getByRole('button', { name: 'Send request' }).click()
  await expect(page.getByRole('status')).toHaveText('Request sent. It’s in the list below.')
}

test('a published app files requests into rows of its own, which publishing again keeps', async ({ page }) => {
  const id = await storedId('Team requests')
  expect(await publishStored(id, { slug: 'requests' })).toMatchObject({ version: 1 })

  // The app starts from the sample rows, and its page shows at any path.
  await page.goto('http://requests.localhost:4173/board')
  await expect(page).toHaveTitle('Team requests')
  const table = page.locator('.fd-table-block')
  await expect(table.locator('tbody tr')).toHaveCount(5)
  await fileRequest(page, 'Order printer toner')
  await expect(table.locator('tbody tr')).toHaveCount(6)
  await expect(page.getByText('6 requests so far')).toBeVisible()
  // A status changes in place there too.
  const status = page.getByRole('combobox', { name: 'Status of “Order printer toner”' })
  await status.selectOption('done')
  await expect(page.locator('.fd-table-select[aria-busy]')).toHaveCount(0)

  // The draft's preview has its own rows, without the app's request.
  await page.goto(`/preview.html?model=${encodeURIComponent(id)}`)
  await expect(page.locator('.fd-table-block tbody tr')).toHaveCount(5)
  await expect(page.getByText('Order printer toner')).toHaveCount(0)

  // The draft changes and is published again: the app shows the change and keeps its rows.
  await changeStored(id, (model) => (model.name = 'Office requests'))
  expect(await publishStored(id, {})).toMatchObject({ version: 2 })
  await page.goto('http://requests.localhost:4173/')
  await expect(page).toHaveTitle('Office requests')
  await expect(table.locator('tbody tr')).toHaveCount(6)
  await expect(page.getByRole('combobox', { name: 'Status of “Order printer toner”' })).toHaveValue('done')
  await page.reload()
  await expect(table.locator('tbody tr')).toHaveCount(6)
})

test("a first publish can start the app's rows from the draft's", async ({ page }) => {
  const id = await storedId('Team requests')
  await page.goto(`/preview.html?model=${encodeURIComponent(id)}`)
  await fileRequest(page, 'Fix the projector')
  await publishStored(id, { slug: 'requests', copyDraftRows: true })
  await page.goto('http://requests.localhost:4173/')
  await expect(page.locator('.fd-table-block tbody tr')).toHaveCount(6)
  await expect(page.getByText('Fix the projector')).toBeVisible()
})

test('says when nothing is published at an address', async ({ page }) => {
  await page.goto('http://nothing-here.localhost:4173/')
  await expect(page.getByText('Nothing is published at this address.')).toBeVisible()
  await expect(page).toHaveTitle('App')
})
