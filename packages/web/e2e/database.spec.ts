import { expect, test, type Page } from '@playwright/test'
import { isolateNetwork } from './network'
import { stored, storedId } from './storage'

// A Database table's rows are the Worker's (the rows API, here over a store of the test's own): the Team requests
// sample files, lists, counts and deletes them.
isolateNetwork()

const requestsTable = async (id: string) => (await stored(id)).features.find((f) => f.feature === 'DatabaseTableFeature')!

async function preview(page: Page): Promise<string> {
  const id = await storedId('Team requests')
  await page.goto(`/preview.html?model=${encodeURIComponent(id)}`)
  return id
}

test('the preview files a request into the Database table, which its table and count show, and keeps it', async ({ page }) => {
  await preview(page)
  const table = page.locator('.fd-table-block')
  await expect(table.locator('tbody tr')).toHaveCount(5)
  await expect(page.getByText('5 requests so far, newest at the bottom.')).toBeVisible()

  // A required field left empty is refused before anything is sent.
  await page.getByRole('button', { name: 'Send request' }).click()
  await expect(page.getByRole('alert')).toHaveText('What do you need? is required.')

  await page.getByLabel('What do you need?').fill('Order printer toner')
  await page.getByLabel('Details').fill('The black cartridge for the second-floor printer.\nTwo, if they come in a pack.')
  await page.getByLabel(/^Your name/).fill('Ana Ruiz')
  // A choice is a select starting at its default, and a date a date field.
  await expect(page.getByLabel('Priority')).toHaveValue('normal')
  await page.getByLabel('Priority').selectOption('urgent')
  await page.getByLabel('Needed by').fill('2026-11-03')
  await page.getByRole('button', { name: 'Send request' }).click()
  await expect(page.getByRole('status')).toHaveText('Request sent. It’s in the list below.')

  // The form starts over, and the new row has the status the table gives new rows.
  await expect(page.getByLabel('What do you need?')).toHaveValue('')
  await expect(page.getByLabel('Priority')).toHaveValue('normal')
  await expect(table.locator('tbody tr')).toHaveCount(6)
  const added = table.locator('tbody tr').last()
  await expect(added).toContainText('Order printer toner')
  await expect(added).toContainText('Ana Ruiz')
  await expect(added).toContainText('urgent')
  await expect(added).toContainText('open')
  await expect(added).toContainText('Nov 3, 2026')
  await expect(page.getByText('6 requests so far')).toBeVisible()

  // Stored by the Worker, not the browser: still there after a reload.
  await page.reload()
  await expect(table.locator('tbody tr')).toHaveCount(6)

  // Any row of a Database table can be deleted, after confirming.
  await table.getByRole('button', { name: 'Delete row 6' }).click()
  await table.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(table.locator('tbody tr')).toHaveCount(5)
  await expect(page.getByText('5 requests so far')).toBeVisible()
})

test('the editor canvas shows the rows, and says a form would send from the preview', async ({ page }) => {
  const id = await storedId('Team requests')
  await page.goto(`/models/${encodeURIComponent(id)}`)
  const canvas = page.locator('.fd-editor-canvas')
  await expect(canvas.locator('.fd-table-block tbody tr')).toHaveCount(5)
  await canvas.getByLabel('What do you need?').fill('Order printer toner')
  await canvas.getByLabel(/^Your name/).fill('Ana Ruiz')
  await canvas.getByRole('button', { name: 'Send request' }).click()
  await expect(canvas.getByRole('alert')).toHaveText('Nothing is sent from the editor. Open the preview to try it.')
  await expect(canvas.locator('.fd-table-block tbody tr')).toHaveCount(5)
})

test("the inspector edits a Database table's fields, saying what it can't take", async ({ page }) => {
  const id = await storedId('Team requests')
  const tableId = (await requestsTable(id)).id
  await page.goto(`/models/${encodeURIComponent(id)}`)
  await page.getByTestId('feature-tree').locator(`[data-tree-id="${tableId}"]`).click()
  const fields = page.getByTestId('inspector').locator('[data-table-fields]')
  await expect(fields.locator('li')).toHaveCount(6)

  await fields.getByRole('button', { name: 'Add field' }).click()
  await expect(fields.locator('li')).toHaveCount(7)
  const name = fields.getByLabel('Name of field 7')
  await name.fill('first room')
  await name.press('Enter')
  await expect(fields.getByRole('alert')).toContainText("can't be a field name")
  await name.fill('room')
  await name.press('Enter')
  await fields.getByLabel('Type of room').selectOption('choice')
  const options = fields.getByLabel('Options of room, separated by |')
  await options.fill('North, upstairs | South')
  await options.press('Enter')
  await fields.getByLabel('Default of room').selectOption('South')
  await fields.locator('li[data-field="room"]').getByLabel('Required').check()
  await expect
    .poll(async () => (await requestsTable(id)).inputs.fields)
    .toEqual([
      'title: text, required',
      'details: long text',
      'requested_by: text, required',
      'priority: choice low | normal | urgent, default normal',
      'status: choice open | in progress | done, required, default open',
      'due: date',
      'room: choice "North, upstairs" | South, required, default South',
    ])

  // Moving and removing fields, and the lines as text.
  await fields.getByRole('button', { name: 'Move room up' }).click()
  await fields.getByRole('button', { name: 'Remove details' }).click()
  await fields.getByRole('button', { name: 'Edit as text' }).click()
  await expect(fields.locator('textarea')).toHaveValue(/requested_by: text, required\n.*\n.*\nroom: choice .*\ndue: date$/)
})
