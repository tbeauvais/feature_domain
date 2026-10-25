import { removeFeature } from '@feature-domain/engine'
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

test('the editor publishes from its dialog, says when the draft changed, asks before removing a table, and unpublishes', async ({ page }) => {
  const id = await storedId('Team requests')
  await page.goto(`/models/${encodeURIComponent(id)}`)
  await expect(page.getByTestId('model-name')).toHaveValue('Team requests')
  await expect(page.getByTestId('publish-state')).toHaveText('')

  // A first publish: the address name is suggested from the model's name, and checked as it is typed.
  await page.getByTestId('open-publish').click()
  const dialog = page.getByTestId('publish-dialog')
  const slug = dialog.getByLabel('Address name')
  await expect(slug).toHaveValue('team-requests')
  await expect(dialog.getByText('http://team-requests.localhost:4173/')).toBeVisible()
  await slug.fill('a')
  await expect(dialog.getByText('An address name is 3 to 40 characters long')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled()
  await slug.fill('requests')
  await expect(dialog.getByLabel(/Start the app with the draft’s rows/)).not.toBeChecked()
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(dialog.getByRole('status')).toHaveText('Published version 1 at http://requests.localhost:4173/.')
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByTestId('publish-state')).toHaveText('Published v1')
  await expect(page.getByTestId('publish-state').getByRole('link')).toHaveAttribute('href', 'http://requests.localhost:4173/')

  // An edit makes the draft differ from what's live.
  await page.getByTestId('model-name').fill('Office requests')
  await expect(page.getByTestId('publish-state')).toHaveText('Published v1 · unpublished changes')

  // A draft without the table: publishing deletes the app's rows in it (its sample rows, stored once the app showed
  // them), so each is confirmed with its count.
  await expect(page.getByTestId('save-state')).toHaveText('Saved')
  await page.goto('http://requests.localhost:4173/')
  await expect(page.locator('.fd-table-block tbody tr')).toHaveCount(5)
  await changeStored(id, (model) => {
    // The table, and the table and form showing it.
    const table = model.features.find((f) => f.feature === 'DatabaseTableFeature')!.id
    const users = model.features.filter((f) => f.feature !== 'TextFeature' && Object.values(f.inputs).includes(table)).map((f) => f.id)
    model.features = [table, ...users].reduce((m, removed) => removeFeature(m, removed).model, model).features
  })
  await page.goto(`/models/${encodeURIComponent(id)}`)
  await page.getByTestId('open-publish').click()
  await expect(dialog.getByText('Version 1 is live at')).toBeVisible()
  await expect(dialog.getByText('Fix these first')).toHaveCount(0)
  const remove = dialog.getByLabel('Delete “Requests” and the app’s 5 rows in it')
  await expect(dialog.getByRole('button', { name: 'Publish version 2' })).toBeDisabled()
  await remove.check()
  await dialog.getByRole('button', { name: 'Publish version 2' }).click()
  await expect(dialog.getByRole('status')).toHaveText('Published version 2 at http://requests.localhost:4173/.')
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByTestId('publish-state')).toHaveText('Published v2')

  // Unpublishing is asked in the dialog.
  await page.getByTestId('open-publish').click()
  await dialog.getByRole('button', { name: 'Unpublish…' }).click()
  await dialog.getByRole('group', { name: 'Unpublish' }).getByRole('button', { name: 'Unpublish' }).click()
  await expect(dialog.getByText('Not published now. Version 2 was the last one')).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByTestId('publish-state')).toHaveText('Not published')
  await page.goto('http://requests.localhost:4173/')
  await expect(page.getByText('Nothing is published at this address.')).toBeVisible()
})

test('the dialog lists versions and publishes an earlier one again, leaving the draft as it is', async ({ page }) => {
  const id = await storedId('Team requests')
  await publishStored(id, { slug: 'requests' })
  await changeStored(id, (model) => (model.name = 'Office requests'))
  await publishStored(id, {})
  await page.goto(`/models/${encodeURIComponent(id)}`)
  await expect(page.getByTestId('publish-state')).toHaveText('Published v2')

  await page.getByTestId('open-publish').click()
  const dialog = page.getByTestId('publish-dialog')
  const versions = dialog.getByRole('list', { name: 'Versions' })
  await expect(versions.getByRole('listitem')).toHaveCount(2)
  await expect(versions.getByRole('listitem').first()).toContainText('v2')
  await expect(versions.getByRole('listitem').first()).toContainText('Live')
  await versions.getByRole('button', { name: 'Publish version 1 again' }).click()
  await expect(dialog.getByTestId('publish-source')).toContainText('Publishing version 1 (Team requests) again, as version 3. The draft stays as it is.')
  await dialog.getByRole('button', { name: 'Publish version 1 again' }).last().click()
  await expect(dialog.getByRole('status')).toHaveText('Published version 3 at http://requests.localhost:4173/.')
  await dialog.getByRole('button', { name: 'Close' }).click()
  // The draft is still the newer one, so it now differs from what's live.
  await expect(page.getByTestId('model-name')).toHaveValue('Office requests')
  await expect(page.getByTestId('publish-state')).toHaveText('Published v3 · unpublished changes')
  await page.goto('http://requests.localhost:4173/')
  await expect(page).toHaveTitle('Team requests')
})
