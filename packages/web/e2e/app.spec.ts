import { expect, test, type Page } from '@playwright/test'
import { isolateNetwork } from './network'

// Every request leaves localhost only to the GitHub and Open-Meteo APIs, which are mocked, so runs are deterministic and
// offline-safe.
isolateNetwork((route, url) => {
  if (url.hostname === 'api.open-meteo.com') {
    return route.fulfill({
      json: {
        current_units: { temperature_2m: '°F' },
        current: { temperature_2m: url.searchParams.get('latitude') === '26.7056' ? 81 : 54, weather_code: 3, is_day: 1 },
        daily: { time: ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14'], weather_code: [3, 0, 61, 3], temperature_2m_max: [60, 62, 58, 55], temperature_2m_min: [45, 47, 44, 40] },
      },
    })
  }
  if (url.hostname !== 'api.github.com') return undefined
  const user = url.pathname.split('/')[2]
  // A user's profile (the portfolio's line of values reads it); anything else is their repos.
  if (/^\/users\/[^/]+$/.test(url.pathname)) return route.fulfill({ json: { login: user, public_repos: 30, followers: 12, created_at: '2011-03-07T10:00:00Z' } })
  return route.fulfill({
    json: [
      { name: `${user}-engine`, description: 'Parametric engine', language: 'TypeScript', updated_at: '2015-03-07T10:00:00Z', html_url: `https://github.com/${user}/engine` },
      { name: `${user}-web`, description: null, language: 'Vue', updated_at: '2016-12-17T08:48:05Z', html_url: `https://github.com/${user}/web` },
    ],
  })
})

async function openSample(page: Page, name: string): Promise<string> {
  await page.goto('/')
  await page.getByRole('link', { name, exact: true }).click()
  await expect(page.getByTestId('model-name')).toHaveValue(name)
  return decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!)
}

/** Puts a model into the app's browser storage (the home page must have loaded, so the samples are seeded first). */
async function store(page: Page, model: { id: string }) {
  await page.evaluate((m) => {
    const stored = JSON.parse(localStorage.getItem('feature-domain:models')!)
    stored.models[m.id] = m
    stored.order.push(m.id)
    localStorage.setItem('feature-domain:models', JSON.stringify(stored))
  }, model)
}

test('lists the sample models', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('model-list').getByRole('link')).toHaveText(['Start here', 'Harbor Coffee', 'Ledgerly pricing', 'Northwind sales', 'Tom Beauvais · projects', 'Shoreline JS meetup'])
})

test('a table that really scrolls is a named, focusable region, until phone width shows every row', async ({ page }) => {
  await page.context().route('https://api.github.com/**', (route) =>
    route.fulfill({ json: Array.from({ length: 30 }, (_, i) => ({ name: `repo-${i}`, description: '', language: 'Vue', updated_at: '2015-03-07T10:00:00Z', html_url: 'https://github.com/x/r' })) }),
  )
  await openSample(page, 'Tom Beauvais · projects')
  const wrap = page.getByTestId('canvas').locator('[data-feature-id="9"] .fd-table-wrap')
  await expect(wrap.locator('tbody tr')).toHaveCount(30)
  await expect(wrap).toHaveAttribute('tabindex', '0')
  await expect(wrap).toHaveAttribute('role', 'region')
  await expect(wrap).toHaveAccessibleName('Recently updated')
  // The header stays in view while the rows scroll.
  await wrap.evaluate((el) => (el.scrollTop = 200))
  const offset = await wrap.evaluate((el) => el.querySelector('th')!.getBoundingClientRect().top - el.getBoundingClientRect().top)
  expect(Math.abs(offset)).toBeLessThan(2)
  // At phone width every row shows and the page scrolls instead, so the box is no longer a tab stop.
  await page.getByTestId('canvas-width-phone').click()
  await expect(wrap).not.toHaveAttribute('tabindex')
  await expect(wrap).not.toHaveAttribute('role')
})

test('neighboring texts and links sit on their own lines, and empty containers and panels leave no gaps or empty cards', async ({ page }) => {
  await openSample(page, 'Tom Beauvais · projects')
  const canvas = page.getByTestId('canvas')
  // A Text and a Link one after the other: each starts on its own line, not run together as in the legacy app.
  const tops = await Promise.all(['7', '8'].map(async (id) => (await canvas.locator(`[data-feature-id="${id}"]`).boundingBox())!.y))
  expect(tops[1]!).toBeGreaterThan(tops[0]! + 10)

  // In the preview, a container holding nothing (here its map and weather, disabled) adds no margin.
  const id = await openSample(page, 'Harbor Coffee')
  // Away from the editor first, so its autosave can't write over the change.
  await page.goto(`/preview.html?model=${encodeURIComponent(id)}`)
  await page.evaluate((modelId) => {
    const stored = JSON.parse(localStorage.getItem('feature-domain:models')!)
    for (const f of stored.models[modelId].features) if (f.feature === 'GoogleMapFeature' || f.feature === 'WeatherFeature') f.inputs.disable = true
    localStorage.setItem('feature-domain:models', JSON.stringify(stored))
  }, id)
  await page.reload()
  await expect(page.locator('[data-feature-id="14"]')).toHaveCount(0)
  await expect(page.locator('[data-feature-id="13"]')).toHaveCSS('margin-bottom', '0px')

  // Panels holding only tables, charts and forms (which are cards themselves) draw no card of their own.
  await store(page, {
    id: 'panels',
    version: 2,
    name: 'Panels',
    features: [
      { feature: 'DataResourceFeature', id: '1', inputs: { name: 'Orders', source: 'sample', sample_rows: '[{"item": "Tea", "qty": 2}]' } },
      { feature: 'PageFeature', id: '2', inputs: { name: 'Page' }, placement: { parent: '$root', slot: 'content' } },
      { feature: 'PanelFeature', id: '3', inputs: { heading: 'Orders' }, placement: { parent: '2', slot: 'content' } },
      { feature: 'TableFeature', id: '4', inputs: { data_resource: '1' }, placement: { parent: '3', slot: 'body' } },
      { feature: 'PanelFeature', id: '5', inputs: { heading: 'New order' }, placement: { parent: '2', slot: 'content' } },
      { feature: 'FormFeature', id: '6', inputs: { data_resource: '1' }, placement: { parent: '5', slot: 'body' } },
    ],
  } as { id: string })
  await page.goto('/preview.html?model=panels')
  const bodies = page.locator('.fd-panel-body')
  await expect(bodies).toHaveCount(2)
  for (const body of await bodies.all()) {
    await expect(body).toHaveCSS('border-top-style', 'none')
    await expect(body).toHaveCSS('padding-top', '0px')
  }
})

test('renders the samples\' live tables and values, maps and weather, with no problems', async ({ page }) => {
  await openSample(page, 'Tom Beauvais · projects')
  const canvas = page.getByTestId('canvas')
  await expect(canvas.getByRole('heading', { name: 'Tom Beauvais', level: 1 })).toBeVisible()
  // A text reads values from the GitHub profile, live.
  await expect(canvas.locator('[data-feature-id="7"]')).toHaveText('30 public repositories · 12 followers · on GitHub since Mar 7, 2011')

  // The repo table: fields name/description/language/updated_at, filtered as a link, plain, badge and date.
  const table = canvas.locator('[data-feature-id="9"]')
  await expect(table.locator('th')).toHaveText(['Repository', 'Description', 'Language', 'Updated'])
  await expect(table.locator('tbody tr').first().locator('td')).toHaveText(['tbeauvais-engine', 'Parametric engine', 'TypeScript', 'Mar 7, 2015'])
  await expect(table.getByRole('link', { name: 'tbeauvais-engine' })).toHaveAttribute('href', 'https://github.com/tbeauvais/engine')
  await expect(table.locator('.fd-badge')).toHaveText(['TypeScript', 'Vue'])
  await expect(table).toContainText('2 rows')
  // Two rows don't fill a table that scrolls after 10: no tab stop with nothing to scroll.
  await expect(table.locator('.fd-table-wrap')).not.toHaveAttribute('tabindex')
  const look = await table.evaluate((block) => {
    const th = block.querySelector('th')!
    const date = block.querySelector('tbody td:last-child')!
    return {
      tableBorder: getComputedStyle(block).borderTopStyle,
      // Labels in the body font, not spaced capitals; the header row stays in view while rows scroll.
      label: [getComputedStyle(th).textTransform, getComputedStyle(th).letterSpacing, getComputedStyle(th).position],
      date: [getComputedStyle(date).textAlign, getComputedStyle(date).fontVariantNumeric],
    }
  })
  expect(look).toEqual({ tableBorder: 'solid', label: ['none', 'normal', 'sticky'], date: ['right', 'tabular-nums'] })

  // At phone width each row is a small card: no header row, and labeled values.
  await page.getByTestId('canvas-width-phone').click()
  await expect(table.locator('thead')).toHaveCSS('position', 'absolute')
  await expect(table.locator('tbody tr').first()).toHaveCSS('display', 'block')
  const label = await table.locator('tbody td').nth(2).evaluate((td) => getComputedStyle(td, '::before').content)
  expect(label).toBe('"Language"')
  // Badges keep their own width, and a scrolling table shows every row (the page scrolls instead).
  const badge = table.locator('.fd-badge').first()
  expect((await badge.boundingBox())!.width).toBeLessThan(120)
  await expect(table.locator('.fd-table-wrap')).toHaveCSS('max-height', 'none')
  await page.getByTestId('canvas-width-desktop').click()
  await expect(page.getByTestId('problems-toggle')).toContainText('No problems')

  await openSample(page, 'Harbor Coffee')
  // Panel headings are plain text: no decorative dot before them.
  const marker = await canvas.locator('.fd-panel-heading h4', { hasText: 'Hours' }).evaluate((h) => getComputedStyle(h, '::before').content)
  expect(marker).toBe('none')
  const weather = canvas.locator('[data-feature-id="15"]')
  await expect(weather.locator('.fd-heading')).toHaveText('Weather on the green')
  await expect(weather.locator('.fd-weather-temp')).toHaveText('54°F')
  // The map is a card with our drawing and a link to Google Maps, named with the address.
  const map = canvas.locator('[data-feature-id="14"]')
  await expect(map.locator('.fd-heading')).toHaveText('Visit us')
  await expect(map.getByRole('link', { name: 'Open 37 Whitfield St, Guilford, CT in Google Maps' })).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=37%20Whitfield%20St%2C%20Guilford%2C%20CT')
  // The drawing fills the card's width (auto margins would shrink it to its minimum in the card's flex column).
  const fill = await map.evaluate((card) => [card.querySelector('.fd-illustration')!.getBoundingClientRect().width, card.querySelector('.fd-paragraph')!.getBoundingClientRect().width])
  expect(fill[0]).toBeCloseTo(fill[1]!, 0)
  const overflowing = await canvas.locator('.fd-cell').evaluateAll((cells) => cells.filter((c) => c.scrollWidth > c.clientWidth + 1).map((c) => c.getAttribute('data-node-id')))
  expect(overflowing).toEqual([])
  await expect(canvas.locator('.fd-placeholder')).toHaveCount(0)
  await expect(page.getByTestId('problems-toggle')).toContainText('No problems')
})

test('draws built-in illustrations in the theme\'s colors, in the editor and the preview', async ({ page, context }) => {
  const id = await openSample(page, 'Start here')
  const preview = await context.newPage()
  await preview.goto(`/preview.html?model=${encodeURIComponent(id)}`)
  for (const p of [page, preview]) {
    // The banner is decorative: hidden from screen readers, so found by its feature.
    const banner = p.locator('.fd-illustration[data-feature-id="2"]')
    await expect(banner).toBeVisible()
    await expect(banner).toHaveAttribute('aria-hidden', 'true')
    // Inside .fd-root everything is reset (`all: revert`); SVG geometry and paint are CSS properties, so a reset that
    // reached into the drawing would leave zero-sized circles and default black fills.
    const drawn = await banner.evaluate((frame) => {
      const circle = frame.querySelector('circle')!
      const background = frame.querySelector('rect')!
      const box = frame.getBoundingClientRect()
      return {
        circle: circle.getBoundingClientRect().width,
        fill: getComputedStyle(background).fill,
        band: getComputedStyle(frame).getPropertyValue('--fd-band').trim(),
        aspect: getComputedStyle(frame).aspectRatio,
        height: box.height,
      }
    })
    expect(drawn.circle).toBeGreaterThan(10)
    expect(drawn.fill).toBe('rgb(58, 17, 40)')
    expect(drawn.band).toBe('#3a1128')
    // The samples' banners are short (6:1), but never slivers on narrow pages.
    expect(drawn.aspect).toBe('6 / 1')
    expect(drawn.height).toBeGreaterThanOrEqual(96)
  }
})

test('opens the standalone preview in a new tab', async ({ page, context }) => {
  const id = await openSample(page, 'Harbor Coffee')
  const [preview] = await Promise.all([context.waitForEvent('page'), page.getByTestId('open-preview').click()])
  await expect(preview).toHaveURL(`/preview.html?model=${encodeURIComponent(id)}`)
  await expect(preview.getByRole('heading', { name: 'Harbor Coffee' })).toBeVisible()
  await expect(preview.getByText('Feature Domain')).toHaveCount(0)
})

// Computed styles that legitimately differ between the editor canvas and the full-width preview page: sizes and
// positions that depend on the surrounding layout. Custom properties (--*) are excluded too: the editor defines
// Tailwind's, generated pages only read their own --fd-* ones.
const LAYOUT_DEPENDENT = /^(width|height|inline-size|block-size|top|right|bottom|left|inset-.*|transform-origin|perspective-origin|grid-template-columns|grid-template-rows)$/

// Every computed property of every element in the generated document, in document order, plus which properties
// the editor changes on purpose for that element.
const measureDocument = (target: Page) =>
  target.evaluate((skipPattern) => {
    const skip = new RegExp(skipPattern)
    const root = document.querySelector('.fd-root')!
    // Placeholders for unported features exist only in the editor, by design.
    const elements = [root, ...root.querySelectorAll('*')].filter((el) => !el.closest('.fd-placeholder'))
    return elements.map((el) => {
      const style = getComputedStyle(el)
      const values: Record<string, string> = {}
      for (const name of Array.from(style)) {
        if (!name.startsWith('--') && !skip.test(name)) values[name] = style.getPropertyValue(name)
      }
      // Centered boxes use space that depends on the container width: images, illustrations, separators and lists auto margins, pages equal
      // side padding. Compare "centered" instead (allowing a sub-pixel rounding step).
      const equal = (a: string, b: string) => Math.abs(parseFloat(values[a]!) - parseFloat(values[b]!)) < 0.5
      if (/\bfd-(image|illustration|separator|list)-center\b/.test(String(el.getAttribute('class'))) && equal('margin-left', 'margin-right')) {
        values['margin-left'] = values['margin-right'] = values['margin-inline-start'] = values['margin-inline-end'] = 'centered'
      }
      if (/\bfd-page\b/.test(el.className) && equal('padding-left', 'padding-right')) {
        values['padding-left'] = values['padding-right'] = values['padding-inline-start'] = values['padding-inline-end'] = 'centered'
      }
      // What the editor changes on purpose, and only where it does: drag behavior on draggable elements (user-select
      // is inherited by their content), and a visible drop area on empty slots.
      const editorOnly = [
        ...(el.closest('[draggable="true"]') ? ['user-select', '-webkit-user-select'] : []),
        ...(el.hasAttribute('draggable') ? ['-webkit-user-drag'] : []),
        ...(el.matches('[data-slot]:empty') ? ['min-height', 'outline-color', 'outline-style', 'outline-width', 'outline-offset'] : []),
      ]
      return { node: el.getAttribute('data-node-id') ?? el.tagName.toLowerCase(), values, editorOnly }
    })
  }, LAYOUT_DEPENDENT.source)

type Measured = Awaited<ReturnType<typeof measureDocument>>

/** Both sides with the editor's deliberate per-element changes removed, ready to compare. */
function comparable(preview: Measured, editor: Measured) {
  const strip = (values: Record<string, string>, skip: string[]) => Object.fromEntries(Object.entries(values).filter(([k]) => !skip.includes(k)))
  return {
    preview: preview.map((p, i) => ({ node: p.node, ...strip(p.values, editor[i]?.editorOnly ?? []) })),
    editor: editor.map((e) => ({ node: e.node, ...strip(e.values, e.editorOnly) })),
  }
}

const hasTailwindReset = (target: Page) =>
  target.evaluate(() =>
    [...document.styleSheets].some((sheet) => [...sheet.cssRules].some((rule) => rule.cssText.includes('::file-selector-button'))),
  )

/** Waits until a sample's generated page has settled (data loaded, cards rendered). */
const SAMPLES: { name: string; ready: (target: Page) => Promise<void> }[] = [
  { name: 'Start here', ready: (target) => expect(target.locator('.fd-text')).toHaveCount(5) },
  // A map and a weather card (loaded), a quiet panel, buttons.
  { name: 'Harbor Coffee', ready: (target) => expect(target.locator('.fd-weather-temp')).toHaveCount(1) },
  // Three list cards in a well, with buttons under them.
  { name: 'Ledgerly pricing', ready: (target) => expect(target.locator('.fd-card')).toHaveCount(3) },
  // A table, a chart and a form on an API spec's sample data, and a count read from it.
  {
    name: 'Northwind sales',
    ready: async (target) => {
      await expect(target.locator('.fd-table-block tbody tr')).toHaveCount(6)
      await expect(target.locator('.fd-chart-canvas canvas')).toBeVisible()
    },
  },
  // A live table and a line of live values.
  {
    name: 'Tom Beauvais · projects',
    ready: async (target) => {
      await expect(target.locator('.fd-table-block tbody tr')).toHaveCount(2)
      await expect(target.locator('.fd-text[aria-busy]')).toHaveCount(0)
    },
  },
  // A table, a form and a panel with a count and a map.
  { name: 'Shoreline JS meetup', ready: (target) => expect(target.locator('.fd-table-block tbody tr')).toHaveCount(5) },
]

for (const sample of SAMPLES) {
  test(`renders ${sample.name} identically in the editor and the preview`, async ({ page, context }) => {
    const id = await openSample(page, sample.name)

    const editor = await context.newPage()
    await editor.goto(`/models/${encodeURIComponent(id)}`)
    await sample.ready(editor)
    expect(await hasTailwindReset(editor)).toBe(true)
    // Generated pages size themselves from the document's width (container queries), so render the preview's
    // document at exactly the editor canvas's width.
    const width = await editor.locator('.fd-root').evaluate((el) => el.getBoundingClientRect().width)

    await page.goto(`/preview.html?model=${encodeURIComponent(id)}`)
    await sample.ready(page)
    await page.locator('#app').evaluate((el, w) => ((el as HTMLElement).style.width = `${w}px`), width)
    expect(await page.locator('.fd-root').evaluate((el) => el.getBoundingClientRect().width)).toBe(width)
    expect(await hasTailwindReset(page)).toBe(false)
    const inPreview = await measureDocument(page)

    expect(inPreview.length).toBeGreaterThan(30)
    expect(Object.keys(inPreview[0]!.values).length).toBeGreaterThan(200)
    const inEditor = await measureDocument(editor)
    // The exclusions stay narrow: only the editor's drag behavior (no empty slots in these samples).
    expect(new Set(inEditor.flatMap((e) => e.editorOnly))).toEqual(new Set(['user-select', '-webkit-user-select', '-webkit-user-drag']))
    const first = comparable(inPreview, inEditor)
    expect(first.editor).toEqual(first.preview)

    // Utility classes on the editor's canvas wrapper must not leak into the generated page either.
    await editor
      .getByTestId('canvas')
      .evaluate((el) => el.classList.add('uppercase', 'italic', 'tracking-widest', 'whitespace-nowrap', 'select-none', 'cursor-pointer', 'text-red-500', 'leading-loose', 'text-right'))
    const second = comparable(inPreview, await measureDocument(editor))
    expect(second.editor).toEqual(second.preview)
  })
}

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

test('cards and the buttons under them stay inside their container, and cards side by side line up', async ({ page }) => {
  await openSample(page, 'Ledgerly pricing')
  const canvas = page.getByTestId('canvas')
  // The three plan cards, in a well of their own.
  const well = canvas.locator('.fd-well:has([data-feature-id="6"])')
  const cards = well.locator('.fd-card')
  await expect(cards).toHaveCount(3)
  // Make one card much longer than the others, so equal heights mean the layout stretched them.
  await canvas.locator('[data-feature-id="6"] h4').click()
  await page.getByTestId('inspector').getByLabel('Description').fill('A much longer description. '.repeat(12))
  await expect(canvas.locator('[data-feature-id="6"] .fd-paragraph-muted')).toContainText('much longer')
  const wellBox = (await well.boundingBox())!
  const boxes = await Promise.all((await well.locator('.fd-card, .fd-button').all()).map((el) => el.boundingBox()))
  expect(boxes.length).toBe(6)
  for (const box of boxes) {
    expect(box!.y).toBeGreaterThanOrEqual(wellBox.y)
    expect(box!.y + box!.height).toBeLessThanOrEqual(wellBox.y + wellBox.height)
  }
  const heights = await Promise.all((await cards.all()).map(async (card) => (await card.boundingBox())!.height))
  expect(new Set(heights.map(Math.round)).size).toBe(1)

  // A Text feature in a card's cell (a paragraph of its own) doesn't stop that cell lining up with its neighbors.
  await page.getByTestId('palette-TextFeature').click()
  const cell = canvas.locator('.fd-cell:has([data-feature-id="6"])')
  await expect(cell.locator('.fd-text')).toHaveCount(1)
  await expect(cell).toHaveCSS('display', 'flex')
})

test('the sales dashboard\'s form logs a deal that its table, chart and count show at once, and the deal can be deleted', async ({ page }) => {
  const id = await openSample(page, 'Northwind sales')
  await page.goto(`/preview.html?model=${encodeURIComponent(id)}`)
  const table = page.locator('.fd-table-block')
  await expect(table.locator('tbody tr')).toHaveCount(6)
  const chartRows = page.locator('.fd-chart-block .fd-visually-hidden tbody tr')
  await expect(chartRows).toHaveCount(6)
  const count = page.locator('[data-feature-id="5"]')
  await expect(count).toContainText('6 deals closed this quarter.')

  // The spec requires a rep, a region and an amount: an amount alone is refused.
  await page.getByLabel(/^Amount/).fill('15000')
  await page.getByRole('button', { name: 'Log deal' }).click()
  await expect(page.getByRole('alert')).toHaveText('Sales rep is required.')
  await expect(table.locator('tbody tr')).toHaveCount(6)
  await page.getByLabel(/^Sales rep/).fill('Taylor Brooks')
  await page.getByLabel(/^Region/).fill('South')
  await page.getByRole('button', { name: 'Log deal' }).click()
  await expect(page.getByRole('status')).toHaveText('Deal logged.')
  await expect(table.locator('tbody tr')).toHaveCount(7)
  await expect(table.locator('tbody tr').last()).toContainText('Taylor Brooks')
  await expect(chartRows.last()).toHaveText('Taylor Brooks$15,000.00')
  await expect(count).toContainText('7 deals closed this quarter.')

  // Only the logged deal can be deleted, after confirming.
  await expect(table.getByRole('button', { name: /^Delete row/ })).toHaveCount(1)
  await table.getByRole('button', { name: 'Delete row 7' }).click()
  await expect(table.getByText('Delete this row?')).toBeVisible()
  await table.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(table.locator('tbody tr')).toHaveCount(6)
  await expect(chartRows).toHaveCount(6)
  await expect(count).toContainText('6 deals closed this quarter.')
})

test('on the editor canvas, text in a form field can be selected with the mouse without dragging the form', async ({ page }) => {
  await openSample(page, 'Northwind sales')
  const input = page.locator('.fd-editor-canvas .fd-form input[name="rep"]')
  await input.fill('Taylor Brooks')
  const box = (await input.boundingBox())!
  await page.mouse.move(box.x + 4, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 })
  await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  expect(await input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 13])
})
