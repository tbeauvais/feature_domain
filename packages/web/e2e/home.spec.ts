import { expect, test, type Page } from '@playwright/test'
import { HOME_ID } from '../src/stores/apiModelStore'
import { isolateNetwork } from './network'
import { changeStored, removeStored, stored, storedId } from './storage'

// The home page: the built-in home model (an API spec on the models API, a form and a table), and the model list
// that takes its place, with Reset home page, when it is missing or broken.

isolateNetwork()

const home = (page: Page) => page.getByTestId('home-page')
const models = (page: Page) => home(page).getByRole('table').getByRole('link')
const SAMPLES = ['Start here', 'Harbor Coffee', 'Ledgerly pricing', 'Northwind sales', 'Tom Beauvais · projects', 'Shoreline JS meetup', 'Team requests']

test('lists the models, each opening in the editor in the same tab', async ({ page }) => {
  await page.goto('/')
  await expect(models(page)).toHaveText(SAMPLES)
  await expect(home(page).getByRole('table')).toContainText('Oct 20, 2026')
  await models(page).filter({ hasText: 'Harbor Coffee' }).click()
  await expect(page).toHaveURL(`/models/${await storedId('Harbor Coffee')}`)
  await expect(page.getByTestId('model-name')).toHaveValue('Harbor Coffee')
})

test('starts a new model from its name and opens it', async ({ page }) => {
  await page.goto('/')
  await home(page).getByLabel('Name').fill('Corner bakery')
  await home(page).getByRole('button', { name: 'Create model' }).click()
  await expect(page.getByTestId('model-name')).toHaveValue('Corner bakery')
  const id = await storedId('Corner bakery')
  await expect(page).toHaveURL(`/models/${id}`)
  expect((await stored(id)).features.map((f) => f.feature)).toEqual(['PageFeature'])

  // Back home, it is listed last.
  await page.goBack()
  await expect(models(page)).toHaveText([...SAMPLES, 'Corner bakery'])
})

test('deletes a model from its row, after asking', async ({ page }) => {
  await page.goto('/')
  const table = home(page).getByRole('table')
  await expect(models(page)).toHaveCount(SAMPLES.length)
  await table.getByRole('button', { name: 'Delete row 2' }).click()
  await expect(table.getByText('Delete this row?')).toBeVisible()
  await table.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(models(page)).toHaveText(SAMPLES.filter((name) => name !== 'Harbor Coffee'))
  await expect(storedId('Harbor Coffee')).rejects.toThrow('0 stored models')
})

test('Edit home page opens it in the editor, and its changes show on the home page', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Edit home page' }).click()
  await expect(page).toHaveURL(`/models/${HOME_ID}`)
  await expect(page.getByTestId('model-name')).toHaveValue('Home page')
  await page.getByTestId('feature-tree').getByText('Title', { exact: true }).click()
  await page.getByTestId('inspector').getByLabel('Text').fill('Everything we build')
  await expect(page.getByTestId('save-state')).toHaveText('Saved')
  await page.getByRole('link', { name: 'Feature Domain' }).click()
  await expect(home(page).getByRole('heading', { level: 1 })).toHaveText('Everything we build')
  await expect(models(page)).toHaveCount(SAMPLES.length)
})

test('shows the model list when the home page is gone, and Reset home page puts it back', async ({ page }) => {
  await removeStored(HOME_ID)
  await page.goto('/')
  await expect(page.getByTestId('home-fallback')).toContainText('There is no home page, so here is the model list.')
  await expect(page.getByTestId('model-list').getByRole('link')).toHaveText(SAMPLES)
  await expect(page.getByRole('link', { name: 'Edit home page' })).toHaveCount(0)
  await page.getByTestId('reset-home').click()
  await expect(models(page)).toHaveText(SAMPLES)
  await expect(page.getByTestId('home-fallback')).toHaveCount(0)
})

test('shows the model list when the home page is broken, and asks before resetting it', async ({ page }) => {
  await changeStored(HOME_ID, (model) => {
    model.features = model.features.filter((f) => f.feature !== 'PageFeature')
  })
  await page.goto('/')
  await expect(page.getByTestId('home-fallback')).toContainText("The home page can't be shown")
  await expect(page.getByTestId('model-list')).toBeVisible()
  // It can still be fixed in the editor instead.
  await expect(page.getByRole('link', { name: 'Edit home page' })).toBeVisible()
  await page.getByTestId('reset-home').click()
  await page.getByTestId('confirm-dialog').getByTestId('confirm-ok').click()
  await expect(models(page)).toHaveText(SAMPLES)
  expect((await stored(HOME_ID)).features.some((f) => f.feature === 'PageFeature')).toBe(true)
})

test('All models opens the built-in list, which leaves out the home page', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'All models' }).click()
  await expect(page).toHaveURL('/models')
  await expect(page.getByTestId('model-list').getByRole('link')).toHaveText(SAMPLES)
})
