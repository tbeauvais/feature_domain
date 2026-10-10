import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { isolateNetwork } from './network'

// Screenshots of every sample, and of every Header and Panel option, at desktop and phone width, so the look can't
// regress unnoticed. Text rendering differs between operating systems, so baselines are Linux only: they are made and
// compared in the Playwright Docker image (`npm run e2e:docker`), which CI runs in too.
test.skip(process.platform !== 'linux', 'Screenshots are compared on Linux only; run `npm run e2e:docker` from packages/web')

const PHOTO = readFileSync(new URL('./fixtures/photo.png', import.meta.url))

// Sample photos from other sites become one flat local picture, and GitHub returns fixed rows, so every run looks the same.
isolateNetwork((route, url) => {
  if (url.hostname === 'api.github.com') {
    const user = url.pathname.split('/')[2]
    return route.fulfill({
      json: [
        { name: `${user}-engine`, description: 'Parametric engine', language: 'TypeScript', updated_at: '2015-03-07T10:00:00Z', html_url: `https://github.com/${user}/engine` },
        { name: `${user}-web`, description: null, language: 'Vue', updated_at: '2016-12-17T08:48:05Z', html_url: `https://github.com/${user}/web` },
        { name: `${user}-docs`, description: 'Notes and guides', language: 'Ruby', updated_at: '2014-01-07T12:00:00Z', html_url: `https://github.com/${user}/docs` },
      ],
    })
  }
  if (route.request().resourceType() === 'image') return route.fulfill({ body: PHOTO, contentType: 'image/png' })
  return undefined
})

const WIDTHS = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } } as const
const SAMPLES = ['Getting Started', 'Buy Deal', 'Data Sample', 'Swagger Data Sample', 'Watson Sample']

/** A model showing every Header colour on every background, and every Panel emphasis, in the given scheme. */
function optionsModel(id: string, scheme: 'light' | 'dark') {
  const at = { parent: '1', slot: 'content' }
  const features: object[] = [
    { feature: 'ThemeFeature', id: 't', inputs: { name: 'Theme', scheme } },
    { feature: 'PageFeature', id: '1', inputs: { name: 'Page', theme: 't' }, placement: { parent: '$root', slot: 'content' } },
  ]
  for (const background of ['none', 'tint', 'band'])
    for (const colour of ['ink', 'accent', 'muted'])
      features.push({ feature: 'HeaderFeature', id: `h-${background}-${colour}`, inputs: { text: `${colour} on ${background}`, colour, background, size: 3 }, placement: at })
  for (const emphasis of ['normal', 'highlight', 'quiet']) {
    features.push({ feature: 'PanelFeature', id: `p-${emphasis}`, inputs: { heading: `Panel, ${emphasis}`, emphasis }, placement: at })
    features.push({ feature: 'TextFeature', id: `t-${emphasis}`, inputs: { text: 'Open weekdays 9 to 6. Free parking behind the building.' }, placement: { parent: `p-${emphasis}`, slot: 'body' } })
  }
  return { version: 2, id, name: `Options (${scheme})`, features }
}

/** The id of a model listed on the home page (which also seeds the samples on first use). */
async function modelId(page: Page, name: string): Promise<string> {
  await page.goto('/')
  const href = await page.getByTestId('model-list').getByRole('link', { name, exact: true }).getAttribute('href')
  return decodeURIComponent(href!.split('/').pop()!)
}

async function snapshot(page: Page, id: string, name: string) {
  await page.goto(`/preview.html?model=${encodeURIComponent(id)}`)
  await expect(page.locator('.fd-root')).toBeVisible()
  // Wait for tables to load and web fonts to arrive, so nothing is mid-change.
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true, animations: 'disabled' })
}

for (const [size, viewport] of Object.entries(WIDTHS)) {
  test.describe(`${size} width`, () => {
    test.use({ viewport })

    for (const sample of SAMPLES) {
      test(`${sample} looks as it should`, async ({ page }) => {
        await snapshot(page, await modelId(page, sample), `${sample.toLowerCase().replaceAll(' ', '-')}-${size}`)
      })
    }

    for (const scheme of ['light', 'dark'] as const) {
      test(`every Header and Panel option looks as it should (${scheme})`, async ({ page }) => {
        await page.goto('/')
        const id = `options-${scheme}`
        await page.evaluate((model) => {
          const key = 'feature-domain:models'
          const stored = JSON.parse(localStorage.getItem(key) ?? '{"order":[],"models":{}}')
          stored.models[model.id] = model
          if (!stored.order.includes(model.id)) stored.order.push(model.id)
          localStorage.setItem(key, JSON.stringify(stored))
        }, optionsModel(id, scheme))
        await snapshot(page, id, `options-${scheme}-${size}`)
      })
    }
  })
}
