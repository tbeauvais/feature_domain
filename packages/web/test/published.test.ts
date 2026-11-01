import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadPublishedApp, PUBLISHED_APP_PATH } from '../src/published'
import { FETCH_JSON, type FetchJson } from '../src/renderer/rows'
import PublishedApp from '../src/views/PublishedApp.vue'
import { inst, model, page } from './helpers'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const published = {
  ...model(
    page(),
    inst('DatabaseTableFeature', '2', { name: 'Requests', fields: ['title: text'], sample_rows: '[]' }, null),
    inst('TableFeature', '3', { data_resource: '2' }),
  ),
  id: 'm1',
  name: 'Team requests',
}

describe('loadPublishedApp', () => {
  it('reads the published app once and generates it', async () => {
    const fetchImpl = vi.fn(async () => json(published))
    const app = await loadPublishedApp(fetchImpl as unknown as typeof fetch)
    expect(app).toMatchObject({ status: 'ready', id: 'm1', name: 'Team requests' })
    expect(fetchImpl).toHaveBeenCalledWith(PUBLISHED_APP_PATH, expect.objectContaining({ redirect: 'manual' }))
  })

  it('says why it shows nothing', async () => {
    const load = (answer: () => Promise<Response>) => loadPublishedApp(answer as unknown as typeof fetch)
    expect(await load(async () => json({ error: 'No app is published at this address' }, 404))).toEqual({ status: 'none' })
    expect(await load(async () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } }))).toEqual({ status: 'signed-out' })
    expect(await load(async () => Response.redirect('https://login.test/', 302))).toEqual({ status: 'signed-out' })
    expect(await load(async () => json({}, 500))).toMatchObject({ status: 'error', message: expect.stringContaining('(500)') })
    // Cloudflare's own error page is a failure, not a sign-in.
    expect(await load(async () => new Response('<html>', { status: 502, headers: { 'Content-Type': 'text/html' } }))).toMatchObject({
      status: 'error',
      message: expect.stringContaining('(502)'),
    })
    expect(await load(async () => Promise.reject(new DOMException('slow', 'TimeoutError')))).toEqual({
      status: 'error',
      message: "The server didn't answer in time.",
    })
    const noPage = { ...published, features: [published.features[1]!] }
    expect(await load(async () => json(noPage))).toEqual({ status: 'error', message: 'The app has no page to show.' })
    expect(await load(async () => json({ version: 2, name: 'No features' }))).toMatchObject({ status: 'error', message: expect.stringContaining('valid') })
    expect(await load(async () => json({ ...published, id: undefined }))).toMatchObject({ status: 'error', message: expect.stringContaining('no id') })
    expect(await load(async () => Promise.reject(new TypeError('Failed to fetch')))).toMatchObject({ status: 'error' })
  })

  it("tells the app's own sign-in from an expired Access session", async () => {
    const load = (answer: () => Promise<Response>) => loadPublishedApp(answer as unknown as typeof fetch)
    expect(await load(async () => json({ error: 'Sign in to open this app', sign_in: { app: 'Members' } }, 401))).toEqual({ status: 'sign-in', app: 'Members' })
    expect(await load(async () => json({ error: 'Listed only', sign_in: { app: 'Board', email: 'ann@example.com' } }, 403))).toEqual({
      status: 'sign-in',
      app: 'Board',
      email: 'ann@example.com',
    })
    // A 401 that isn't the app's sign-in answer is a failure like any other.
    expect(await load(async () => json({ error: 'No' }, 401))).toMatchObject({ status: 'error', message: expect.stringContaining('(401)') })
  })
})

describe('PublishedApp', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('says who the app is open to when it asks for sign-in', async () => {
    vi.stubGlobal('fetch', async () => json({ error: 'Sign in to open this app', sign_in: { app: 'Members' } }, 401))
    const w = mount(PublishedApp)
    await flushPromises()
    expect(w.text()).toBe('Members is open only to people signed in.')
    vi.stubGlobal('fetch', async () => json({ error: 'Listed only', sign_in: { app: 'Board', email: 'eve@example.com' } }, 403))
    const listed = mount(PublishedApp)
    await flushPromises()
    expect(listed.text()).toBe("Board is open only to the people it lists, and eve@example.com isn't one of them.")
  })

  it('renders the app, reading its live rows on its own host, and names the page after it', async () => {
    vi.stubGlobal('fetch', async () => json(published))
    const fetchJson = vi.fn<FetchJson>(async () => [{ title: 'Paint the hall' }])
    const w = mount(PublishedApp, { global: { provide: { [FETCH_JSON as symbol]: fetchJson } } })
    await flushPromises()
    await flushPromises()
    expect(w.text()).toContain('Paint the hall')
    expect(fetchJson).toHaveBeenCalledWith('/api/v1/app/tables/2/rows')
    expect(document.title).toBe('Team requests')
    w.unmount()
  })

  it('offers to try again after a failure', async () => {
    let answer: () => Promise<Response> = () => Promise.reject(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', () => answer())
    const w = mount(PublishedApp, { global: { provide: { [FETCH_JSON as symbol]: vi.fn<FetchJson>(async () => []) } } })
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toContain("Couldn't reach the server.")
    answer = async () => json(published)
    await w.get('button').trigger('click')
    await flushPromises()
    expect(w.find('[role="alert"]').exists()).toBe(false)
    expect(w.find('.fd-root').exists()).toBe(true)
    w.unmount()
  })

  it('says when nothing is published there', async () => {
    vi.stubGlobal('fetch', async () => json({ error: 'No app is published at this address' }, 404))
    const w = mount(PublishedApp)
    await flushPromises()
    expect(w.text()).toBe('Nothing is published at this address.')
    w.unmount()
  })
})
