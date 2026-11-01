import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { isolateNetwork } from './network'

// Signing in to a published app through the built Worker, its real D1 database and Better Auth in workerd: the codes go
// to the development mailer, read back from the app's host (GET /api/v1/app/dev/mail, served only on localhost).

isolateNetwork(undefined, { realModels: true })

const PORT = 4173

/** Stores and publishes an app open only to people signed in; returns its address. */
async function membersApp(request: APIRequestContext): Promise<string> {
  const slug = `members-${Math.random().toString(36).slice(2, 10)}`
  const stored = await request.post('/api/v1/models', {
    data: {
      version: 2,
      name: 'Harbor members',
      features: [
        { feature: 'ThemeFeature', id: '1', inputs: { name: 'Harbor', accent: '#1f6f8b' } },
        { feature: 'PageFeature', id: '2', inputs: { name: 'Home', theme: '1' }, placement: { parent: '$root', slot: 'content' } },
        { feature: 'AccountFeature', id: '3', inputs: {}, placement: { parent: '2', slot: 'content' } },
        { feature: 'TextFeature', id: '4', inputs: { text: 'The members’ newsletter' }, placement: { parent: '2', slot: 'content' } },
        { feature: 'SignInFeature', id: '5', inputs: { open_to: 'signed-in' } },
      ],
    },
  })
  expect(stored.status()).toBe(201)
  const { id } = (await stored.json()) as { id: string }
  const published = await request.post(`/api/v1/models/${id}/publish`, { data: { slug }, headers: { 'If-Match': stored.headers().etag! } })
  expect(published.status()).toBe(200)
  return `http://${slug}.localhost:${PORT}`
}

/** The emails the development mailer sent to `to` from the app, oldest first. */
const mailsTo = async (request: APIRequestContext, app: string, to: string) =>
  (await (await request.get(`${app}/api/v1/app/dev/mail?to=${encodeURIComponent(to)}`)).json()) as { text: string }[]

/** The next email to `to` after the `before` already sent (codes go out in the background, after the answer). */
async function nextMail(request: APIRequestContext, app: string, to: string, before: number): Promise<string> {
  let text = ''
  await expect(async () => {
    const mails = await mailsTo(request, app, to)
    expect(mails.length).toBeGreaterThan(before)
    text = mails.at(-1)!.text
  }).toPass()
  return text
}
const codeIn = (mail: string) => /is (\d{6})\./.exec(mail)![1]!

/** Asks for a code on the sign-in page; returns the email it sent. */
async function askForCode(page: Page, request: APIRequestContext, app: string, email: string): Promise<string> {
  const before = (await mailsTo(request, app, email)).length
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Email me a code' }).click()
  await expect(page.getByRole('status')).toContainText(`If ${email} can sign in, a code is on its way.`)
  return nextMail(request, app, email, before)
}

test('signs up with an emailed code, signs out, and signs in again with the emailed link', async ({ page, request }) => {
  const app = await membersApp(request)
  const email = `ann-${Date.now()}@example.com`

  // Signed out, the app is its sign-in page, in the app's theme.
  await page.goto(`${app}/`)
  await expect(page.getByRole('heading', { name: 'Sign in to Harbor members' })).toBeVisible()
  await expect(page).toHaveTitle('Sign in · Harbor members')
  await expect(page.getByText('The members’ newsletter')).toHaveCount(0)

  // A first sign-in makes the account.
  await page.getByLabel('Code').fill(codeIn(await askForCode(page, request, app, email)))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByText('The members’ newsletter')).toBeVisible()
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()
  await page.reload()
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in to Harbor members' })).toBeVisible()

  // The email's link opens the sign-in page with the code filled in, and signing in opens the app.
  const link = /sign in with this link: (\S+)/.exec(await askForCode(page, request, app, email))![1]!
  expect(link).toMatch(new RegExp(`^${app}/sign-in\\?email=.+#code=\\d{6}$`))
  await page.goto(link)
  await expect(page.getByLabel('Code')).toHaveValue(/^\d{6}$/)
  expect(new URL(page.url()).hash).toBe('')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(`${app}/`)
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()
})

test('deletes an account, asked inline first', async ({ page, request }) => {
  const app = await membersApp(request)
  const email = `bo-${Date.now()}@example.com`
  await page.goto(`${app}/`)
  await page.getByLabel('Code').fill(codeIn(await askForCode(page, request, app, email)))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()

  await page.getByRole('button', { name: 'Delete my account' }).click()
  await page.getByRole('button', { name: 'Keep' }).click()
  await expect(page.getByRole('button', { name: 'Delete my account' })).toBeFocused()
  await page.getByRole('button', { name: 'Delete my account' }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sign in to Harbor members' })).toBeVisible()
})

test('a wrong code is said, and signs no one in', async ({ page, request }) => {
  const app = await membersApp(request)
  const email = `cy-${Date.now()}@example.com`
  await page.goto(`${app}/`)
  const code = codeIn(await askForCode(page, request, app, email))
  await page.getByLabel('Code').fill(code === '000000' ? '111111' : '000000')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText("That code isn't right, or it has expired. Check it, or ask for a new one.")
  await expect(page.getByText('The members’ newsletter')).toHaveCount(0)
})

test('a booking only its member can delete: another member is told so, and the booking stays', async ({ browser, request }) => {
  const slug = `club-${Math.random().toString(36).slice(2, 10)}`
  const stored = await request.post('/api/v1/models', {
    data: {
      version: 2,
      name: 'Rowing club',
      features: [
        { feature: 'PageFeature', id: '1', inputs: { name: 'Home' }, placement: { parent: '$root', slot: 'content' } },
        { feature: 'SignInFeature', id: '2', inputs: { open_to: 'signed-in' } },
        {
          feature: 'DatabaseTableFeature',
          id: '3',
          inputs: { name: 'Bookings', fields: ['boat: text, required'], add_rows: 'signed-in', delete_rows: 'owner' },
        },
        { feature: 'AccountFeature', id: '4', inputs: {}, placement: { parent: '1', slot: 'content' } },
        {
          feature: 'FormFeature',
          id: '5',
          inputs: { title: 'Book', data_resource: '3', submit_label: 'Book it' },
          placement: { parent: '1', slot: 'content' },
        },
        {
          feature: 'TableFeature',
          id: '6',
          inputs: { title: 'Bookings', data_resource: '3', delete_operation: 'DELETE rows' },
          placement: { parent: '1', slot: 'content' },
        },
      ],
    },
  })
  const { id } = (await stored.json()) as { id: string }
  expect((await request.post(`/api/v1/models/${id}/publish`, { data: { slug }, headers: { 'If-Match': stored.headers().etag! } })).status()).toBe(200)
  const app = `http://${slug}.localhost:${PORT}`

  /** A member signed in on a page of their own (their own cookies). */
  const member = async (email: string) => {
    const page = await (await browser.newContext()).newPage()
    await page.goto(`${app}/`)
    await page.getByLabel('Code').fill(codeIn(await askForCode(page, request, app, email)))
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()
    return page
  }
  const ann = await member(`ann-${Date.now()}@example.com`)
  await ann.getByLabel('Boat').fill('Heron')
  await ann.getByRole('button', { name: 'Book it' }).click()
  await expect(ann.getByRole('table')).toContainText('Heron')

  const bo = await member(`bo-${Date.now()}@example.com`)
  await expect(bo.getByRole('table')).toContainText('Heron')
  await bo
    .getByRole('table')
    .getByRole('button', { name: /^Delete row/ })
    .click()
  await bo.getByRole('table').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(bo.locator('.fd-table-delete-problem')).toHaveText("Couldn't delete the row: Only the person who added a row can delete it")
  await bo.reload()
  await expect(bo.getByRole('table')).toContainText('Heron')

  await ann.reload()
  await ann
    .getByRole('table')
    .getByRole('button', { name: /^Delete row/ })
    .click()
  await ann.getByRole('table').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(ann.getByRole('table').getByText('Heron')).toHaveCount(0)
})
