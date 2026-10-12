import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { isolateNetwork } from './network'

// Screenshots of every sample (and Start here in the Night Garden theme), of every Header and Panel option, every chart type and Weather card, at desktop and phone width, so the look can't
// regress unnoticed. Text rendering differs between operating systems, so baselines are Linux only: they are made and
// compared in the Playwright Docker image (`npm run e2e:docker`), which CI runs in too.
test.skip(process.platform !== 'linux', 'Screenshots are compared on Linux only; run `npm run e2e:docker` from packages/web')

const PHOTO = readFileSync(new URL('./fixtures/photo.png', import.meta.url))

// Sample photos from other sites become one flat local picture, GitHub returns fixed rows and profiles, and Open-Meteo fixed weather, so
// every run looks the same.
isolateNetwork((route, url) => {
  if (url.hostname === 'api.github.com') {
    const user = url.pathname.split('/')[2]
    if (/^\/users\/[^/]+$/.test(url.pathname)) return route.fulfill({ json: { login: user, public_repos: 30, followers: 12, created_at: '2011-03-07T10:00:00Z' } })
    return route.fulfill({
      json: [
        { name: `${user}-engine`, description: 'Parametric engine', language: 'TypeScript', updated_at: '2015-03-07T10:00:00Z', html_url: `https://github.com/${user}/engine` },
        { name: `${user}-web`, description: null, language: 'Vue', updated_at: '2016-12-17T08:48:05Z', html_url: `https://github.com/${user}/web` },
        { name: `${user}-docs`, description: 'Notes and guides', language: 'Ruby', updated_at: '2014-01-07T12:00:00Z', html_url: `https://github.com/${user}/docs` },
      ],
    })
  }
  if (url.hostname === 'api.open-meteo.com') {
    const weather = FORECASTS[url.searchParams.get('latitude') ?? '']
    if (!weather) return route.fulfill({ status: 503, body: 'Service Unavailable' })
    const [code, isDay, days] = weather
    return route.fulfill({
      json: {
        current_units: { temperature_2m: url.searchParams.get('temperature_unit') === 'celsius' ? '°C' : '°F' },
        current: { temperature_2m: 71.6, weather_code: code, is_day: isDay },
        daily: { time: ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14'], weather_code: [0, ...days], temperature_2m_max: [75, 78, 74, 69], temperature_2m_min: [60, 63, 61, 55] },
      },
    })
  }
  if (route.request().resourceType() === 'image') return route.fulfill({ body: PHOTO, contentType: 'image/png' })
  return undefined
})

/** Fixed weather by latitude (current code, day or night, the next days' codes), so the cards show every icon. */
const FORECASTS: Record<string, [number, number, number[]]> = {
  '26.7056': [0, 1, [2, 61, 95]],
  '41.289': [1, 0, [3, 45, 73]],
  '64.1466': [0, 0, []],
}

const WIDTHS = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } } as const
const SAMPLES = ['Start here', 'Harbor Coffee', 'Ledgerly pricing', 'Northwind sales', 'Tom Beauvais · projects', 'Shoreline JS meetup']

/** A model showing every Header color on every background, and every Panel emphasis, in the given scheme. */
function optionsModel(id: string, scheme: 'light' | 'dark') {
  const at = { parent: '1', slot: 'content' }
  const features: object[] = [
    { feature: 'ThemeFeature', id: 't', inputs: { name: 'Theme', scheme } },
    { feature: 'PageFeature', id: '1', inputs: { name: 'Page', theme: 't' }, placement: { parent: '$root', slot: 'content' } },
  ]
  for (const background of ['none', 'tint', 'band'])
    for (const color of ['ink', 'accent', 'muted'])
      features.push({ feature: 'HeaderFeature', id: `h-${background}-${color}`, inputs: { text: `${color} on ${background}`, color, background, size: 3 }, placement: at })
  for (const emphasis of ['normal', 'highlight', 'quiet']) {
    features.push({ feature: 'PanelFeature', id: `p-${emphasis}`, inputs: { heading: `Panel, ${emphasis}`, emphasis }, placement: at })
    features.push({ feature: 'TextFeature', id: `t-${emphasis}`, inputs: { text: 'Open weekdays 9 to 6. Free parking behind the building.' }, placement: { parent: `p-${emphasis}`, slot: 'body' } })
  }
  return { version: 2, id, name: `Options (${scheme})`, features }
}

/** A model with a chart of every type over the same sample rows, in the given scheme. */
function chartsModel(id: string, scheme: 'light' | 'dark') {
  const rows = [
    { region: 'North', sales: 18250 },
    { region: 'South', sales: 12900 },
    { region: 'East', sales: 9600 },
    { region: 'West', sales: 7400 },
    { region: 'Online', sales: 4300 },
    { region: 'Partners', sales: 2100 },
  ]
  const at = { parent: '1', slot: 'content' }
  const features: object[] = [
    { feature: 'ThemeFeature', id: 't', inputs: { name: 'Theme', scheme, well: 'band' } },
    { feature: 'DataResourceFeature', id: 'r', inputs: { name: 'Sales', source: 'sample', sample_rows: JSON.stringify(rows) } },
    { feature: 'PageFeature', id: '1', inputs: { name: 'Page', theme: 't' }, placement: { parent: '$root', slot: 'content' } },
  ]
  for (const chart_type of ['pie', 'donut', 'column', 'bar', 'line'])
    features.push({ feature: 'GoogleChartFeature', id: `c-${chart_type}`, inputs: { title: `Sales by region (${chart_type})`, data_resource: 'r', chart_type, height: 'short' }, placement: at })
  // On a band well, charts use the band's own colors.
  features.push({ feature: 'ContainerFeature', id: 'well', inputs: { rows: 1, columns: 2, well: true }, placement: at })
  features.push({ feature: 'GoogleChartFeature', id: 'c-band-col', inputs: { title: 'On a band', data_resource: 'r', chart_type: 'column', height: 'short' }, placement: { parent: 'well', slot: 'r1c1' } })
  features.push({ feature: 'GoogleChartFeature', id: 'c-band-pie', inputs: { title: 'On a band', data_resource: 'r', chart_type: 'donut', height: 'short' }, placement: { parent: 'well', slot: 'r1c2' } })
  return { version: 2, id, name: `Charts (${scheme})`, features }
}

/**
 * Weather cards in a well (a band in light, the theme's own well in dark), between them showing every icon, plus one
 * whose forecast fails to load.
 */
function weatherModel(id: string, scheme: 'light' | 'dark') {
  const cell = (slot: string) => ({ parent: 'well', slot })
  const features: object[] = [
    { feature: 'ThemeFeature', id: 't', inputs: { name: 'Theme', scheme, ...(scheme === 'light' ? { well: 'band' } : {}) } },
    { feature: 'PageFeature', id: '1', inputs: { name: 'Page', theme: 't' }, placement: { parent: '$root', slot: 'content' } },
    { feature: 'HeaderFeature', id: 'h', inputs: { text: 'Two New Locations', size: 2, align: 'center' }, placement: { parent: '1', slot: 'content' } },
    { feature: 'ContainerFeature', id: 'well', inputs: { rows: 2, columns: 2, well: true }, placement: { parent: '1', slot: 'content' } },
    { feature: 'WeatherFeature', id: 'w1', inputs: { title: 'Where it’s Warm', place: 'Palm Beach, Florida', latitude: '26.7056', longitude: '-80.0364' }, placement: cell('r1c1') },
    { feature: 'WeatherFeature', id: 'w2', inputs: { place: 'Guilford, Connecticut', latitude: '41.2890', longitude: '-72.6818' }, placement: cell('r1c2') },
    { feature: 'WeatherFeature', id: 'w3', inputs: { place: 'Reykjavík, Iceland', latitude: '64.1466', longitude: '-21.9426', units: 'celsius', show: 'current' }, placement: cell('r2c1') },
    { feature: 'WeatherFeature', id: 'w4', inputs: { place: 'Somewhere offline', latitude: '10', longitude: '10' }, placement: cell('r2c2') },
  ]
  return { version: 2, id, name: `Weather (${scheme})`, features }
}

/** Puts a model into the app's browser storage. */
async function store(page: Page, model: { id: string }) {
  await page.evaluate((m) => {
    const key = 'feature-domain:models'
    const stored = JSON.parse(localStorage.getItem(key) ?? '{"order":[],"models":{}}')
    stored.models[m.id] = m
    if (!stored.order.includes(m.id)) stored.order.push(m.id)
    localStorage.setItem(key, JSON.stringify(stored))
  }, model)
}

/** A sample's name as a file name: "Tom Beauvais · projects" -> "tom-beauvais-projects". */
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

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
        await snapshot(page, await modelId(page, sample), `${slug(sample)}-${size}`)
      })
    }

    test('Start here in the Night Garden theme looks as it should', async ({ page }) => {
      // Applied as a user would: add a Theme (it themes the page), then start it from Night Garden.
      const id = await modelId(page, 'Start here')
      await page.goto(`/models/${encodeURIComponent(id)}`)
      await page.getByTestId('palette-ThemeFeature').click()
      await page.getByTestId('inspector').locator('[data-preset="night-garden"]').click()
      await expect(page.getByTestId('theme-summary')).toContainText('Night Garden')
      await expect(page.getByText('Saved')).toBeVisible()
      await snapshot(page, id, `start-here-night-garden-${size}`)
    })

    for (const scheme of ['light', 'dark'] as const) {
      test(`every chart type looks as it should (${scheme})`, async ({ page }) => {
        await page.goto('/')
        await store(page, chartsModel(`charts-${scheme}`, scheme))
        await snapshot(page, `charts-${scheme}`, `charts-${scheme}-${size}`)
      })

      test(`Weather cards look as they should (${scheme})`, async ({ page }) => {
        await page.goto('/')
        await store(page, weatherModel(`weather-${scheme}`, scheme))
        await snapshot(page, `weather-${scheme}`, `weather-${scheme}-${size}`)
      })

      test(`every Header and Panel option looks as it should (${scheme})`, async ({ page }) => {
        await page.goto('/')
        const id = `options-${scheme}`
        await store(page, optionsModel(id, scheme))
        await snapshot(page, id, `options-${scheme}-${size}`)
      })
    }
  })
}
