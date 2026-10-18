import { expect, test } from '@playwright/test'
import { isolateNetwork } from './network'
import { answerProxy, stored, store } from './storage'

// Fetch through: Server. The browser can't read rows.example.test (every request off localhost is blocked, as a site
// without CORS would be); the Worker's real proxy route can, answered here by a fake site.
isolateNetwork()

const resource = (id: string, method: string, fetchThrough?: string) => ({
  feature: 'DataResourceFeature',
  id,
  inputs: {
    name: `Rows ${method}`,
    source: 'address',
    resource: 'https://rows.example.test/rows',
    operation: method,
    ...(fetchThrough ? { fetch_through: fetchThrough } : {}),
  },
})
const onPage = (feature: string, id: string, inputs: Record<string, unknown>) => ({ feature, id, inputs, placement: { parent: '1', slot: 'content' } })
const page1 = { feature: 'PageFeature', id: '1', inputs: { name: 'Home' }, placement: { parent: '$root', slot: 'content' } }

test('a table whose site refuses the browser loads once its resource fetches through the server', async ({ page }) => {
  const asked: string[] = []
  answerProxy((url, init) => {
    asked.push(`${init.method} ${url}`)
    return Response.json([{ name: 'Ada', city: 'London' }])
  })
  await store(page, { id: 'proxy', version: 2, name: 'Proxy', features: [resource('r', 'GET'), page1, onPage('TableFeature', 't', { data_resource: 'r' })] })
  await page.goto('/models/proxy')
  const table = page.getByTestId('canvas').locator('[data-feature-id="t"]')
  await expect(table).toContainText(
    "rows.example.test: Couldn't load it. If the site doesn't let other pages read its data, set the data resource's Fetch through to Server.",
  )
  expect(asked).toEqual([])

  await page.getByTestId('feature-tree').locator('[data-tree-id="r"]').click()
  await page.getByTestId('inspector').getByRole('button', { name: 'Server' }).click()
  await expect(table.locator('tbody td')).toHaveText(['Ada', 'London'])
  expect(asked).toEqual(['GET https://rows.example.test/rows'])
  // The proxy allowed it because the switch was saved first.
  expect((await stored('proxy')).features.find((f) => f.id === 'r')?.inputs.fetch_through).toBe('server')
})

test('the preview sends a form through the server, and reads through it', async ({ page }) => {
  const asked: string[] = []
  answerProxy(async (url, init) => {
    asked.push(`${init.method} ${url} ${init.body === undefined ? '' : await new Response(init.body).text()}`)
    return init.method === 'POST' ? new Response(null, { status: 201 }) : Response.json([{ name: 'Ada' }])
  })
  await store(page, {
    id: 'send',
    version: 2,
    name: 'Send',
    features: [
      resource('g', 'GET', 'server'),
      resource('p', 'POST', 'server'),
      page1,
      onPage('TableFeature', 't', { data_resource: 'g' }),
      onPage('FormFeature', 'f', { data_resource: 'p', fields: ['name'] }),
    ],
  })
  await page.goto('/preview.html?model=send')
  await expect(page.locator('[data-feature-id="t"] tbody td')).toHaveText('Ada')
  await page.getByLabel('Name').fill('Grace')
  await page.getByRole('button', { name: 'Submit' }).click()
  await expect(page.getByRole('status')).toHaveText('Thanks, that was sent.')
  expect(asked).toEqual(['GET https://rows.example.test/rows ', 'POST https://rows.example.test/rows {"name":"Grace"}'])
})

test("the proxy refuses an address that isn't one of the model's Server addresses", async ({ page }) => {
  answerProxy(() => Response.json([]))
  await store(page, { id: 'refused', version: 2, name: 'Refused', features: [resource('r', 'GET', 'server'), page1] })
  await page.goto('/preview.html?model=refused')
  const answer = await page.evaluate(async () => {
    const response = await fetch('/api/v1/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'refused', method: 'GET', url: 'https://elsewhere.example.test/secrets' }),
    })
    return { status: response.status, body: (await response.json()) as unknown }
  })
  expect(answer).toEqual({ status: 403, body: { error: "It isn't one of this model's addresses fetched through the server" } })
})
