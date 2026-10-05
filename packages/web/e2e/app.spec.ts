import { expect, test, type Page } from '@playwright/test'

// Every request leaves localhost only to the GitHub API, which is mocked, so runs are deterministic and offline-safe.
async function isolateNetwork(page: Page) {
  await page.context().route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'localhost') return route.continue()
    if (url.hostname === 'api.github.com') {
      const user = url.pathname.split('/')[2]
      return route.fulfill({
        json: [
          { name: `${user}-engine`, description: 'Parametric engine', language: 'TypeScript', updated_at: '2015-03-07T10:00:00Z', html_url: `https://github.com/${user}/engine` },
          { name: `${user}-web`, description: null, language: 'Vue', updated_at: '2016-12-17T08:48:05Z', html_url: `https://github.com/${user}/web` },
        ],
      })
    }
    return route.abort()
  })
}

async function openSample(page: Page, name: string): Promise<string> {
  await page.goto('/')
  await page.getByRole('link', { name, exact: true }).click()
  await expect(page.getByTestId('model-name')).toHaveValue(name)
  return decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!)
}

test.beforeEach(async ({ page }) => {
  await isolateNetwork(page)
})

test('lists the migrated sample models', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('model-list').getByRole('link')).toHaveText([
    'Getting Started',
    'Buy Deal',
    'Data Sample',
    'Swagger Data Sample',
    'Watson Sample',
  ])
})

test('renders a sample with containers, panels, live tables and diagnostics', async ({ page }) => {
  await openSample(page, 'Data Sample')
  const canvas = page.getByTestId('canvas')

  await expect(canvas.getByRole('heading', { name: 'Two New Locations', level: 1 })).toBeVisible()
  await expect(canvas.locator('.fd-panel-heading', { hasText: 'My GitHub Repos' })).toBeVisible()

  // Repo Table: fields name/description/language/updated_at with filters uppercase / dataLink / none / date.
  const table = canvas.locator('[data-feature-id="24"]')
  await expect(table.locator('th')).toHaveText(['Name', 'Description', 'Language', 'Updated At'])
  await expect(table.locator('tbody tr').first().locator('td')).toHaveText(['TBEAUVAIS-ENGINE', 'Parametric engine', 'TypeScript', 'Mar 7, 2015'])
  await expect(table.getByRole('link', { name: 'Parametric engine' })).toHaveAttribute('href', 'https://github.com/tbeauvais/engine')
  await expect(canvas.locator('[data-feature-id="38"] tbody tr')).toHaveCount(2)

  // Legacy {{...}} bindings are shown literally, never evaluated, and their long tokens wrap inside the cell.
  await expect(canvas.locator('[data-feature-id="2"]')).toContainText('Temp {{DataResource.WeatherService')
  const overflowing = await canvas.locator('.fd-cell').evaluateAll((cells) => cells.filter((c) => c.scrollWidth > c.clientWidth + 1).map((c) => c.getAttribute('data-node-id')))
  expect(overflowing).toEqual([])

  // List is ported now; unported features show as placeholders in the editor.
  await expect(canvas.locator('[data-feature-id="7"] li')).toHaveText(['Red', 'Green', 'Blue', 'Yellow'])
  await expect(canvas.locator('.fd-placeholder[data-feature-id="16"]')).toContainText('GoogleMapFeature is not ported yet')

  const diagnostics = page.getByTestId('diagnostics').last()
  await expect(diagnostics.locator('[data-code="out-of-order"]')).toHaveCount(3)
  await expect(diagnostics).toContainText('Listed before feature 36 ("repo panel"), which it is placed in')
})

test('opens the standalone preview in a new tab', async ({ page, context }) => {
  const id = await openSample(page, 'Watson Sample')
  const [preview] = await Promise.all([context.waitForEvent('page'), page.getByTestId('open-preview').click()])
  await expect(preview).toHaveURL(`/preview.html?model=${encodeURIComponent(id)}`)
  await expect(preview.getByRole('heading', { name: "Leverage IBM's Watson Services" })).toBeVisible()
  await expect(preview.getByText('Feature Domain')).toHaveCount(0)
})

// Computed styles that legitimately differ between the editor canvas and the full-width preview page: sizes and
// positions that depend on the surrounding layout. Custom properties (--*) are excluded too: the editor defines
// Tailwind's, generated pages only read their own --fd-* ones.
const LAYOUT_DEPENDENT = /^(width|height|inline-size|block-size|transform-origin|perspective-origin|grid-template-columns|grid-template-rows)$/

// Every computed property of every element in the generated document, in document order.
const measureDocument = (target: Page) =>
  target.evaluate((layoutDependent) => {
    const skip = new RegExp(layoutDependent)
    const root = document.querySelector('.fd-root')!
    // Placeholders for unported features exist only in the editor, by design.
    const elements = [root, ...root.querySelectorAll('*')].filter((el) => !el.closest('.fd-placeholder'))
    return elements.map((el) => {
      const style = getComputedStyle(el)
      const values: Record<string, string> = { node: el.getAttribute('data-node-id') ?? el.tagName.toLowerCase() }
      for (const name of Array.from(style)) {
        if (!name.startsWith('--') && !skip.test(name)) values[name] = style.getPropertyValue(name)
      }
      // Centred boxes (images, lists) use auto margins, which resolve to pixels that depend on the container width;
      // compare "centred" instead.
      if (/\bfd-(image|list)-center\b/.test(el.className) && values['margin-left'] === values['margin-right']) {
        values['margin-left'] = values['margin-right'] = values['margin-inline-start'] = values['margin-inline-end'] = 'centred'
      }
      return values
    })
  }, LAYOUT_DEPENDENT.source)

const hasTailwindReset = (target: Page) =>
  target.evaluate(() =>
    [...document.styleSheets].some((sheet) => [...sheet.cssRules].some((rule) => rule.cssText.includes('::file-selector-button'))),
  )

test('renders generated pages identically in the editor and the preview', async ({ page, context }) => {
  const id = await openSample(page, 'Data Sample')

  await page.goto(`/preview.html?model=${encodeURIComponent(id)}`)
  await expect(page.locator('[data-feature-id="24"] tbody tr')).toHaveCount(2)
  expect(await hasTailwindReset(page)).toBe(false)
  const inPreview = await measureDocument(page)

  const editor = await context.newPage()
  await editor.goto(`/models/${encodeURIComponent(id)}`)
  await expect(editor.locator('[data-feature-id="24"] tbody tr')).toHaveCount(2)
  expect(await hasTailwindReset(editor)).toBe(true)

  expect(inPreview.length).toBeGreaterThan(40)
  expect(Object.keys(inPreview[0]!).length).toBeGreaterThan(200)
  expect(await measureDocument(editor)).toEqual(inPreview)

  // Utility classes on the editor's canvas wrapper must not leak into the generated page either.
  await editor
    .getByTestId('canvas')
    .evaluate((el) => el.classList.add('uppercase', 'italic', 'tracking-widest', 'whitespace-nowrap', 'select-none', 'cursor-pointer', 'text-red-500', 'leading-loose', 'text-right'))
  expect(await measureDocument(editor)).toEqual(inPreview)
})

test('shows an error, not a blank page, for a malformed stored model', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('model-list')).toBeVisible()
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('feature-domain:models')!)
    stored.models.malformed = { version: 2, name: 'Malformed' }
    stored.order.push('malformed')
    localStorage.setItem('feature-domain:models', JSON.stringify(stored))
  })
  await page.goto('/models/malformed')
  await expect(page.getByText('Could not load the model: the model is not valid (Model has no features list)')).toBeVisible()
  await page.goto('/preview.html?model=malformed')
  await expect(page.getByText('Could not load the model: the model is not valid (Model has no features list)')).toBeVisible()
})

test('shows a message for a missing model', async ({ page }) => {
  await page.goto('/models/does-not-exist')
  await expect(page.getByText('This model does not exist.')).toBeVisible()
  await page.goto('/preview.html?model=does-not-exist')
  await expect(page.getByText('This model does not exist.')).toBeVisible()
})
