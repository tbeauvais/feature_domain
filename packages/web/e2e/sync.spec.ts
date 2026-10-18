import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { isolateNetwork } from './network'

// Saving through the real Worker and its D1 database, with other tabs and devices saving the same model. "Another
// device" is a request straight to the API, which this browser's tabs don't hear about.

isolateNetwork(undefined, { realModels: true })

const MODELS = '/api/v1/models'
const created: string[] = []

async function newModel(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post(MODELS, {
    data: {
      version: 2,
      name,
      features: [
        { feature: 'PageFeature', id: '1', inputs: { name: 'Page' }, placement: { parent: '$root', slot: 'content' } },
        { feature: 'TextFeature', id: '2', inputs: { text: name }, placement: { parent: '1', slot: 'content' } },
      ],
    },
  })
  const { id } = (await response.json()) as { id: string }
  created.push(id)
  return id
}

/** Saves the model under a new name (and its text) from "another device". */
async function renameElsewhere(request: APIRequestContext, id: string, name: string) {
  const model = await (await request.get(`${MODELS}/${id}`)).json()
  model.features[1].inputs.text = name
  expect((await request.put(`${MODELS}/${id}`, { data: { ...model, name } })).status()).toBe(204)
}

const storedName = async (request: APIRequestContext, id: string) => ((await (await request.get(`${MODELS}/${id}`)).json()) as { name: string }).name

async function open(page: Page, id: string) {
  await page.goto(`/models/${id}`)
  await expect(page.getByTestId('save-state')).toHaveText('Saved')
}

/** What the page does when its tab is shown again: check for changes. */
const showAgain = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))

test.afterEach(async ({ request }) => {
  for (const id of created.splice(0)) await request.delete(`${MODELS}/${id}`)
})

test('the editor saves to the Worker, and what it saved is there after a reload', async ({ page, request }) => {
  const id = await newModel(request, 'Saved through the API')
  await open(page, id)
  await page.getByTestId('model-name').fill('Renamed in the editor')
  await expect(page.getByTestId('save-state')).toHaveText('Saved')
  expect(await storedName(request, id)).toBe('Renamed in the editor')
  await page.reload()
  await expect(page.getByTestId('model-name')).toHaveValue('Renamed in the editor')
})

test('an edit made just before leaving the page is still saved', async ({ page, request }) => {
  const id = await newModel(request, 'Leaving')
  await open(page, id)
  await page.getByTestId('model-name').fill('Saved on the way out')
  // Before the save delay is up: the page sends it as it goes.
  await page.goto('about:blank')
  await expect.poll(() => storedName(request, id)).toBe('Saved on the way out')
})

test('another tab without edits shows a save at once, and so does the preview', async ({ page, context, request }) => {
  const id = await newModel(request, 'Two tabs')
  const other = await context.newPage()
  await open(page, id)
  await open(other, id)
  const preview = await context.newPage()
  await preview.goto(`/preview.html?model=${id}`)

  await page.getByTestId('canvas').locator('[data-feature-id="2"]').dblclick()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Typed in the first tab')
  await page.keyboard.press('Shift+Enter')
  await expect(preview.locator('[data-feature-id="2"]')).toHaveText('Typed in the first tab')
  await expect(other.getByTestId('canvas').locator('[data-feature-id="2"]')).toHaveText('Typed in the first tab')
  await page.getByTestId('model-name').fill('Saved in the first tab')
  await expect(other.getByTestId('model-name')).toHaveValue('Saved in the first tab')
  // The second tab saves on from the first tab's revision: no conflict.
  await other.getByTestId('model-name').fill('Then in the second')
  await expect(other.getByTestId('save-state')).toHaveText('Saved')
  await expect(page.getByTestId('model-name')).toHaveValue('Then in the second')
  expect(await storedName(request, id)).toBe('Then in the second')
})

test('a save from another device is picked up when the tab is shown again, in the editor and the preview', async ({ page, context, request }) => {
  const id = await newModel(request, 'Elsewhere')
  await open(page, id)
  const preview = await context.newPage()
  await preview.goto(`/preview.html?model=${id}`)
  await expect(preview.locator('[data-feature-id="2"]')).toHaveText('Elsewhere')
  await renameElsewhere(request, id, 'From another device')
  await showAgain(page)
  await showAgain(preview)
  await expect(page.getByTestId('model-name')).toHaveValue('From another device')
  await expect(preview.locator('[data-feature-id="2"]')).toHaveText('From another device')
  await expect(page.getByTestId('save-problem')).toHaveCount(0)
})

test('an edit made after another device saved is a conflict: Keep mine saves over theirs', async ({ page, request }) => {
  const id = await newModel(request, 'Conflict')
  await open(page, id)
  await renameElsewhere(request, id, 'Theirs')
  await page.getByTestId('model-name').fill('Mine')
  await expect(page.getByTestId('save-state')).toHaveText('Not saved: changed elsewhere')
  await expect(page.getByTestId('save-problem')).toContainText('Someone else saved this model since you opened it')
  expect(await storedName(request, id)).toBe('Theirs')
  // Edits go on while it is open, and are held.
  await page.getByTestId('model-name').fill('Mine, edited more')
  await page.waitForTimeout(600)
  expect(await storedName(request, id)).toBe('Theirs')

  await page.getByTestId('keep-mine').click()
  await expect(page.getByTestId('save-state')).toHaveText('Saved')
  await expect(page.getByTestId('save-problem')).toHaveCount(0)
  expect(await storedName(request, id)).toBe('Mine, edited more')
})

test('Load their version drops the edits made here', async ({ page, request }) => {
  const id = await newModel(request, 'Conflict')
  await open(page, id)
  await renameElsewhere(request, id, 'Theirs')
  await page.getByTestId('model-name').fill('Mine')
  await expect(page.getByTestId('save-problem')).toBeVisible()
  await page.getByTestId('load-theirs').click()
  await expect(page.getByTestId('model-name')).toHaveValue('Theirs')
  await expect(page.getByTestId('save-state')).toHaveText('Saved')
  await expect(page.getByTestId('undo')).toBeDisabled()
  expect(await storedName(request, id)).toBe('Theirs')
})

test('a model deleted elsewhere can be saved as a new model', async ({ page, request }) => {
  const id = await newModel(request, 'Deleted elsewhere')
  await open(page, id)
  await request.delete(`${MODELS}/${id}`)
  await page.getByTestId('model-name').fill('Rescued')
  await expect(page.getByTestId('save-state')).toHaveText('Not saved: deleted elsewhere')
  await page.getByTestId('save-copy').click()
  await expect(page).not.toHaveURL(`/models/${id}`)
  await expect(page.getByTestId('save-state')).toHaveText('Saved')
  const copy = decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!)
  created.push(copy)
  expect(await storedName(request, copy)).toBe('Rescued')
})

test('deleting the model in the editor drops a save still in flight, with no dialog', async ({ page, request }) => {
  const id = await newModel(request, 'Deleted here')
  await open(page, id)
  // Saves are slow, so one is still in flight when the model is deleted.
  await page.route(`**${MODELS}/${id}`, async (route) => {
    if (route.request().method() === 'PUT') await new Promise((resolve) => setTimeout(resolve, 800))
    await route.fallback()
  })
  await page.getByTestId('model-name').fill('Being saved')
  await expect(page.getByTestId('save-state')).toHaveText('Saving…')
  await page.getByTestId('delete-model').click()
  await page.getByTestId('confirm-dialog').getByTestId('confirm-ok').click()
  await expect(page).toHaveURL('/')
  await page.waitForTimeout(1000)
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0)
  expect((await request.get(`${MODELS}/${id}`)).status()).toBe(404)
})
