import { MemoryModelStore, MemoryRowStore, sampleRowId, type AppModel, type FeatureInstance } from '@feature-domain/engine'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { API_HEADERS, createApp } from '../src/app'
import { PAGE_HEADERS, pageHeaders } from '../src/http'
import type { Env } from '../src/env'
import { MemoryAppStore } from '../src/apps'
import { D1RowStore } from '../src/d1RowStore'
import { HOME_ID } from '../src/home'
import { localD1, type LocalD1 } from './localD1'

// Publishing on the builder (/api/v1/models/:id/publish and /publication) and a published app's site, on the real
// local D1. In development the builder is at localhost and apps at <slug>.localhost (packages/worker/.dev.vars).

const BUILDER = 'http://localhost'
const at = (slug: string) => `http://${slug}.localhost`

const json = (body: unknown, method = 'POST', headers: Record<string, string> = {}): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

const requests = (inputs: Record<string, unknown> = {}, id = '2'): FeatureInstance => ({
  feature: 'DatabaseTableFeature',
  id,
  inputs: {
    name: 'Requests',
    fields: ['title: text, required', 'status: choice open | done, default open'],
    sample_rows: '[{"title": "Paint the hall"}, {"title": "Fix the door", "status": "done"}]',
    ...inputs,
  },
})

const modelWith = (...features: FeatureInstance[]): AppModel => ({
  version: 2,
  name: 'Team requests',
  features: [{ feature: 'PageFeature', id: '1', inputs: { name: 'Home' }, placement: { parent: '$root', slot: 'content' } }, ...features],
})

/** The built app's files, as the assets binding serves them: app.html, one script, and the editor's page otherwise. */
const ASSETS = {
  fetch: async (input: RequestInfo | URL) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname
    if (path === '/app.html') return new Response('<title>App</title>', { headers: { 'Content-Type': 'text/html', ETag: '"app-html"' } })
    if (path === '/assets/app-1.js') return new Response('export {}', { headers: { 'Content-Type': 'text/javascript' } })
    if (path === '/favicon.svg') return new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } })
    return new Response('<title>Editor</title>', { headers: { 'Content-Type': 'text/html' } })
  },
} as unknown as Fetcher

let d1: LocalD1
let env: Env
beforeAll(async () => {
  d1 = await localD1()
  env = { ...d1.env, ASSETS }
}, 60_000)
afterAll(() => d1?.dispose())
beforeEach(() =>
  d1.env.DB.exec('DELETE FROM models; DELETE FROM rows; DELETE FROM sampled_tables; DELETE FROM apps; DELETE FROM versions; DELETE FROM publishing'),
)

const app = createApp()
const request = (url: string, init?: RequestInit) => app.request(url.startsWith('/') ? `${BUILDER}${url}` : url, init, env)

/** Stores a model on the builder; returns its id and revision. */
async function store(model: AppModel = modelWith(requests())): Promise<{ id: string; revision: string }> {
  const response = await request('/api/v1/models', json(model))
  return { id: ((await response.json()) as { id: string }).id, revision: response.headers.get('ETag')! }
}

async function save(id: string, model: AppModel, revision: string): Promise<string> {
  const response = await request(`/api/v1/models/${id}`, json(model, 'PUT', { 'If-Match': revision }))
  expect(response.status).toBe(204)
  return response.headers.get('ETag')!
}

const publish = (id: string, revision: string, body: Record<string, unknown> = {}) =>
  request(`/api/v1/models/${id}/publish`, json(body, 'POST', { 'If-Match': revision }))

const titles = async (url: string) => ((await (await request(url)).json()) as { title: string }[]).map((r) => r.title)

describe('POST /api/v1/models/:id/publish', () => {
  it('publishes the draft as version 1 at its address, served on the app host', async () => {
    const { id, revision } = await store()
    const published = await publish(id, revision, { slug: 'requests' })
    expect(published.status).toBe(200)
    expect(await published.json()).toEqual({ slug: 'requests', url: 'http://requests.localhost/', version: 1, published_at: expect.any(String) })
    const served = await request(`${at('requests')}/api/v1/app`)
    expect(served.status).toBe(200)
    expect(served.headers.get('ETag')).toBe(`"1.${id}"`)
    expect(await served.json()).toEqual({ ...modelWith(requests()), id })
    for (const [name, value] of Object.entries(API_HEADERS)) expect(served.headers.get(name), name).toBe(value)
    expect((await request(`${at('requests')}/api/v1/app`, { headers: { 'If-None-Match': `"1.${id}"` } })).status).toBe(304)
  })

  it("never answers a page that kept another model's app at the address with a 304", async () => {
    const first = await store()
    await publish(first.id, first.revision, { slug: 'requests' })
    const kept = (await request(`${at('requests')}/api/v1/app`)).headers.get('ETag')!
    await request(`/api/v1/models/${first.id}/publication`, { method: 'DELETE' })
    const second = await store(modelWith(requests({ name: 'Other' })))
    await publish(second.id, second.revision, { slug: 'requests' })
    const served = await request(`${at('requests')}/api/v1/app`, { headers: { 'If-None-Match': kept } })
    expect(served.status).toBe(200)
    expect(await served.json()).toMatchObject({ id: second.id })
  })

  it('publishes only the revision named in If-Match', async () => {
    const { id, revision } = await store()
    expect((await request(`/api/v1/models/${id}/publish`, json({ slug: 'requests' }))).status).toBe(428)
    expect((await request(`/api/v1/models/${id}/publish`, json({ slug: 'requests' }, 'POST', { 'If-Match': '*' }))).status).toBe(428)
    expect((await request(`/api/v1/models/${id}/publish`, json({ slug: 'requests' }, 'POST', { 'If-Match': '1' }))).status).toBe(400)
    const huge = await request(
      `/api/v1/models/${id}/publish`,
      json({ slug: 'requests', removeTables: Array(10_000).fill('table') }, 'POST', { 'If-Match': revision }),
    )
    expect(huge.status).toBe(413)
    const saved = await save(id, { ...modelWith(requests()), name: 'Changed' }, revision)
    const stale = await publish(id, revision, { slug: 'requests' })
    expect(stale.status).toBe(412)
    expect(stale.headers.get('ETag')).toBe(saved)
    expect((await publish(id, `W/${saved}`, { slug: 'requests' })).status).toBe(200)
  })

  it('refuses what it should, saying why', async () => {
    const { id, revision } = await store()
    const problems = async (response: Response | Promise<Response>, status: number) => {
      const answer = await response
      expect(answer.status).toBe(status)
      return ((await answer.json()) as { problems?: string[] }).problems
    }
    expect(await problems(publish(id, revision), 400)).toEqual(['Give the app an address name'])
    expect(await problems(publish(id, revision, { slug: 'Team Requests' }), 400)).toEqual(['An address name uses only lowercase letters, digits and hyphens'])
    expect(await problems(publish(id, revision, { slug: 'admin' }), 400)).toEqual(['"admin" is kept for the site itself'])
    expect(await problems(publish(id, revision, { slug: 7 }), 400)).toEqual(['slug must be text'])
    expect(await problems(publish(id, revision, { slug: 'requests', removeTables: 'all' }), 400)).toEqual(['removeTables must be a list of table ids'])
    expect((await publish('missing', '"1"', { slug: 'requests' })).status).toBe(404)
    expect((await request(`/api/v1/models/${id}/publish`, { method: 'POST', headers: { 'If-Match': revision }, body: '{}' })).status).toBe(415)
    expect((await request(`/api/v1/models/${id}/publish`)).status).toBe(405)
    // A model generating with an error isn't published.
    const broken = await store(
      modelWith({ feature: 'TableFeature', id: '3', inputs: { name: 'T', data_resource: '' }, placement: { parent: '1', slot: 'content' } }),
    )
    const refused = await publish(broken.id, broken.revision, { slug: 'broken' })
    expect(refused.status).toBe(400)
    expect(((await refused.json()) as { error: string }).error).toBe('The model has problems to fix before it can be published')
    expect((await request(`${at('requests')}/api/v1/app`)).status).toBe(404)
  })

  it("never publishes the home page, which is the builder's own", async () => {
    await request('/api/v1/home/reset', json({}))
    const home = await request(`/api/v1/models/${HOME_ID}`)
    const answer = await publish(HOME_ID, home.headers.get('ETag')!, { slug: 'home-page' })
    expect(answer.status).toBe(400)
    expect(await answer.json()).toEqual({ error: "The home page is part of the builder, so it can't be published" })
  })

  it("refuses another model's address, and keeps an app's own when publishing again", async () => {
    const first = await store()
    const second = await store()
    expect((await publish(first.id, first.revision, { slug: 'requests' })).status).toBe(200)
    const taken = await publish(second.id, second.revision, { slug: 'requests' })
    expect(taken.status).toBe(409)
    expect(await taken.json()).toEqual({ error: 'Another app has this address', problems: ['"requests" is taken: choose another address name'] })
    // Publishing again keeps the address and counts on.
    const again = await publish(first.id, first.revision)
    expect(await again.json()).toMatchObject({ slug: 'requests', version: 2 })
    expect((await request(`${at('requests')}/api/v1/app`)).headers.get('ETag')).toBe(`"2.${first.id}"`)
    // A new address frees the old one, with no redirect.
    expect(await (await publish(first.id, first.revision, { slug: 'team-requests' })).json()).toMatchObject({ slug: 'team-requests', version: 3 })
    expect((await request(`${at('requests')}/api/v1/app`)).status).toBe(404)
    expect((await publish(second.id, second.revision, { slug: 'requests' })).status).toBe(200)
  })

  it("keeps the app's rows apart from the draft's, and across publishes", async () => {
    const { id, revision } = await store()
    await publish(id, revision, { slug: 'requests' })
    const live = `${at('requests')}/api/v1/app/tables/2/rows`
    const draft = `/api/v1/models/${id}/tables/2/rows`
    // Each starts with the table's sample rows.
    expect(await titles(live)).toEqual(['Paint the hall', 'Fix the door'])
    const filed = await request(live, json({ title: 'Order desk mats' }))
    expect(filed.status).toBe(201)
    const row = (await filed.json()) as { id: string }
    expect(filed.headers.get('Location')).toBe(`/api/v1/app/tables/2/rows/${row.id}`)
    expect(await titles(draft)).toEqual(['Paint the hall', 'Fix the door'])
    expect((await request(`${at('requests')}/api/v1/app/tables/2/rows/${row.id}`, json({ status: 'done' }, 'PATCH'))).status).toBe(200)
    // Editing the draft and publishing again keeps them.
    const saved = await save(id, modelWith(requests({ fields: ['title: text, required', 'status: choice open | done, default open', 'due: date'] })), revision)
    expect((await publish(id, saved)).status).toBe(200)
    expect(await titles(live)).toEqual(['Paint the hall', 'Fix the door', 'Order desk mats'])
    expect((await request(`${at('requests')}/api/v1/app/tables/2/rows/${row.id}`)).status).toBe(200)
  })

  it("serves only the published version's tables, never a draft's newer one", async () => {
    const { id, revision } = await store()
    await publish(id, revision, { slug: 'requests' })
    await save(id, modelWith(requests(), requests({ name: 'Rooms' }, '3')), revision)
    expect((await request(`/api/v1/models/${id}/tables/3/rows`)).status).toBe(200)
    const missing = await request(`${at('requests')}/api/v1/app/tables/3/rows`)
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'The app has no Database table with this id' })
  })

  it("starts a first publish's rows from the draft's when asked, sample rows it deleted included", async () => {
    const { id, revision } = await store()
    const draft = `/api/v1/models/${id}/tables/2/rows`
    await request(draft, json({ title: 'From the draft' }))
    await request(`${draft}/${sampleRowId(0)}`, { method: 'DELETE' })
    expect((await publish(id, revision, { slug: 'requests', copyDraftRows: true })).status).toBe(200)
    const live = `${at('requests')}/api/v1/app/tables/2/rows`
    expect(await titles(live)).toEqual(['Fix the door', 'From the draft'])
    // The copy is the app's own: the draft keeps changing apart from it.
    await request(draft, json({ title: 'Later draft row' }))
    expect(await titles(live)).toEqual(['Fix the door', 'From the draft'])
    // Only a first publish copies.
    const again = await publish(id, revision, { copyDraftRows: true })
    expect(again.status).toBe(400)
    expect(await again.json()).toEqual({ error: "The draft's rows are copied only when a model is first published" })
  })

  it('asks before removing a table the app keeps rows in, then removes them', async () => {
    const { id, revision } = await store(modelWith(requests(), requests({ name: 'Rooms' }, '3')))
    await publish(id, revision, { slug: 'requests' })
    await request(`${at('requests')}/api/v1/app/tables/3/rows`, json({ title: 'Big room' }))
    const saved = await save(id, modelWith(requests()), revision)
    const unconfirmed = await publish(id, saved)
    expect(unconfirmed.status).toBe(409)
    expect(await unconfirmed.json()).toEqual({
      error: 'Publishing removes tables and the rows the app keeps in them',
      problems: ['Confirm removing "Rooms" (3) and its rows'],
    })
    const status = (await (await request(`/api/v1/models/${id}/publication`)).json()) as Record<string, unknown>
    expect(status.live_rows).toEqual({ '2': 0, '3': 3 })
    expect((await publish(id, saved, { removeTables: ['3'] })).status).toBe(200)
    // A table added later under the same id starts afresh.
    const readded = await save(id, modelWith(requests(), requests({ name: 'Rooms again', sample_rows: '[]' }, '3')), saved)
    await publish(id, readded)
    expect(await titles(`${at('requests')}/api/v1/app/tables/3/rows`)).toEqual([])
  })

  it('asks before removing any table the app still keeps rows in, though the newest version lacks it', async () => {
    const { id, revision } = await store()
    await publish(id, revision, { slug: 'requests' })
    // Rows a failed cleanup left behind, of a table no version has now.
    await new D1RowStore(d1.env.DB).create({ model: id, space: 'live', table: '9' }, { title: 'Left behind' })
    // The Publish dialog sees it, with its rows, as it sees the newest version's tables.
    expect(await (await request(`/api/v1/models/${id}/publication`)).json()).toMatchObject({ live_rows: { '2': 0, '9': 1 } })
    const unconfirmed = await publish(id, revision)
    expect(unconfirmed.status).toBe(409)
    expect(((await unconfirmed.json()) as { problems: string[] }).problems).toEqual(['Confirm removing "9" (9) and its rows'])
    expect((await publish(id, revision, { removeTables: ['9'] })).status).toBe(200)
    expect(await new D1RowStore(d1.env.DB).countRows(id, 'live')).toEqual({})
  })
})

describe('a first publish', () => {
  it('publishes a model one request at a time, and serves a first publish only once its rows are set up', async () => {
    // On the real D1 stores, with the rows' copy held until the test lets it go on.
    const rows = new D1RowStore(d1.env.DB)
    const own = createApp({ rows: () => rows })
    const { id, revision } = await store()
    const copy = rows.copySpace.bind(rows)
    let resume!: () => void
    let reached!: () => void
    const atCopy = new Promise<void>((resolve) => (reached = resolve))
    rows.copySpace = async (...args) => {
      reached()
      await new Promise<void>((resolve) => (resume = resolve))
      return copy(...args)
    }
    const send = (body: object) => own.request(`/api/v1/models/${id}/publish`, json(body, 'POST', { 'If-Match': revision }), env)
    const first = send({ slug: 'requests', copyDraftRows: true })
    await atCopy
    // Meanwhile the app isn't served, and another publish or an unpublish waits its turn.
    expect((await own.request(`${at('requests')}/api/v1/app`, undefined, env)).status).toBe(404)
    const second = await send({ slug: 'requests' })
    expect(second.status).toBe(409)
    expect(await second.json()).toEqual({ error: "The model's app is being changed", problems: ['Try again in a moment'] })
    expect((await own.request(`/api/v1/models/${id}/publication`, { method: 'DELETE' }, env)).status).toBe(409)
    resume()
    expect(await (await first).json()).toMatchObject({ version: 1 })
    expect((await own.request(`${at('requests')}/api/v1/app`, undefined, env)).status).toBe(200)
    // Once it is done, the next one goes ahead.
    expect(await (await send({ slug: 'requests' })).json()).toMatchObject({ version: 2 })
  })

  it('takes down what a publish stored for a model deleted meanwhile', async () => {
    const rows = new D1RowStore(d1.env.DB)
    const own = createApp({ rows: () => rows })
    const { id, revision } = await store()
    const keep = rows.keepTables.bind(rows)
    let resume!: () => void
    let reached!: () => void
    const atReset = new Promise<void>((resolve) => (reached = resolve))
    rows.keepTables = async (...args) => {
      reached()
      await new Promise<void>((resolve) => (resume = resolve))
      return keep(...args)
    }
    const publishing = own.request(`/api/v1/models/${id}/publish`, json({ slug: 'requests' }, 'POST', { 'If-Match': revision }), env)
    await atReset
    // Deleting never waits for a publish.
    expect((await own.request(`/api/v1/models/${id}`, { method: 'DELETE' }, env)).status).toBe(204)
    resume()
    expect((await publishing).status).toBe(404)
    expect((await own.request(`${at('requests')}/api/v1/app`, undefined, env)).status).toBe(404)
    expect(await d1.env.DB.prepare('SELECT count(*) AS n FROM versions').first<number>('n')).toBe(0)
  })

  it('stores nothing for a publish whose claim was taken over', async () => {
    const models = new MemoryModelStore()
    const apps = new MemoryAppStore()
    const own = createApp({ store: () => models, rows: () => new MemoryRowStore(), apps: () => apps })
    const id = await models.create(modelWith(requests()))
    const claim = apps.claim.bind(apps)
    // The claim is taken over the moment it is made.
    apps.claim = async (model) => {
      const token = await claim(model)
      await apps.release(model, token!)
      await claim(model)
      return token
    }
    const answer = await own.request(`/api/v1/models/${id}/publish`, json({ slug: 'requests' }, 'POST', { 'If-Match': '"1"' }))
    expect(answer.status).toBe(409)
    expect(await apps.latest(id)).toBeNull()
  })

  it("publishes nothing when the app's rows can't be set up, so trying again can still copy them", async () => {
    const models = new MemoryModelStore()
    const rows = new MemoryRowStore()
    const apps = new MemoryAppStore()
    const own = createApp({ store: () => models, rows: () => rows, apps: () => apps })
    const id = await models.create(modelWith(requests()))
    const copy = rows.copySpace.bind(rows)
    rows.copySpace = () => Promise.reject(new Error('D1 is down'))
    const send = () => own.request(`/api/v1/models/${id}/publish`, json({ slug: 'requests', copyDraftRows: true }, 'POST', { 'If-Match': '"1"' }))
    expect((await send()).status).toBe(500)
    expect(await apps.latest(id)).toBeNull()
    expect(await apps.bySlug('requests')).toBeNull()
    rows.copySpace = copy
    expect(await (await send()).json()).toMatchObject({ version: 1 })
  })
})

describe('/api/v1/models/:id/publication', () => {
  it('says where a model is published, its newest version, and the rows the app keeps', async () => {
    const { id, revision } = await store()
    const never = await request(`/api/v1/models/${id}/publication`)
    expect(await never.json()).toEqual({ published: null, url_template: 'http://{slug}.localhost/', latest: null, live_rows: {} })
    await publish(id, revision, { slug: 'requests' })
    await request(`${at('requests')}/api/v1/app/tables/2/rows`, json({ title: 'Filed' }))
    const answer = await request(`/api/v1/models/${id}/publication`)
    expect(answer.headers.get('Cache-Control')).toBe('no-store')
    expect(await answer.json()).toEqual({
      published: { slug: 'requests', url: 'http://requests.localhost/', version: 1, published_at: expect.any(String) },
      url_template: 'http://{slug}.localhost/',
      latest: { version: 1, published_at: expect.any(String), model: { ...modelWith(requests()), id } },
      live_rows: { '2': 3 },
    })
    expect((await request('/api/v1/models/missing/publication')).status).toBe(404)
  })

  it('unpublishes: the app goes offline and its address is free, its versions and rows stay', async () => {
    const { id, revision } = await store()
    await publish(id, revision, { slug: 'requests' })
    await request(`${at('requests')}/api/v1/app/tables/2/rows`, json({ title: 'Kept' }))
    expect((await request(`/api/v1/models/${id}/publication`, { method: 'DELETE' })).status).toBe(204)
    expect((await request(`${at('requests')}/api/v1/app`)).status).toBe(404)
    expect(await (await request(`/api/v1/models/${id}/publication`)).json()).toMatchObject({ published: null, latest: { version: 1 } })
    // Published again, it counts on and has its rows.
    expect(await (await publish(id, revision, { slug: 'requests' })).json()).toMatchObject({ version: 2 })
    expect(await titles(`${at('requests')}/api/v1/app/tables/2/rows`)).toEqual(['Paint the hall', 'Fix the door', 'Kept'])
  })

  it('goes with its model', async () => {
    const { id, revision } = await store()
    await publish(id, revision, { slug: 'requests' })
    expect((await request(`/api/v1/models/${id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await request(`${at('requests')}/api/v1/app`)).status).toBe(404)
    const versions = await d1.env.DB.prepare('SELECT count(*) AS n FROM versions').first<number>('n')
    expect(versions).toBe(0)
  })
})

describe('versions', () => {
  it('lists them newest first, reads one, and publishes an earlier one again as the next version', async () => {
    const { id, revision } = await store()
    await publish(id, revision, { slug: 'requests' })
    const renamed = await save(id, { ...modelWith(requests()), name: 'Office requests' }, revision)
    await publish(id, renamed)
    const list = await request(`/api/v1/models/${id}/versions`)
    expect(list.headers.get('Cache-Control')).toBe('no-store')
    expect(await list.json()).toEqual([
      { version: 2, published_at: expect.any(String), name: 'Office requests' },
      { version: 1, published_at: expect.any(String), name: 'Team requests' },
    ])
    expect(await (await request(`/api/v1/models/${id}/versions/1`)).json()).toEqual({
      version: 1,
      published_at: expect.any(String),
      model: { ...modelWith(requests()), id },
    })
    for (const path of ['3', '0', 'x', '01']) expect((await request(`/api/v1/models/${id}/versions/${path}`)).status, path).toBe(404)

    // Rolling back: version 1 again, as version 3; the draft stays as it is, and the app keeps its rows.
    await request(`${at('requests')}/api/v1/app/tables/2/rows`, json({ title: 'Filed' }))
    const again = await request(`/api/v1/models/${id}/versions/1/publish`, json({}))
    expect(await again.json()).toMatchObject({ slug: 'requests', version: 3 })
    expect(await (await request(`${at('requests')}/api/v1/app`)).json()).toMatchObject({ name: 'Team requests' })
    expect(await (await request(`/api/v1/models/${id}`)).json()).toMatchObject({ name: 'Office requests' })
    expect(await titles(`${at('requests')}/api/v1/app/tables/2/rows`)).toContain('Filed')
    expect((await request(`/api/v1/models/${id}/versions/9/publish`, json({}))).status).toBe(404)
    expect((await request(`/api/v1/models/${id}/versions/x/publish`, json({}))).status).toBe(404)
    expect((await request(`/api/v1/models/${id}/versions/1/publish`, json({ copyDraftRows: true }))).status).toBe(400)
    expect((await request(`/api/v1/models/${id}/versions/1/publish`, { method: 'POST', body: '{}' })).status).toBe(415)
    expect((await request(`/api/v1/models/missing/versions`)).status).toBe(404)
  })

  it("refuses an earlier version that doesn't generate cleanly any more, as it refuses a draft", async () => {
    const apps = new MemoryAppStore()
    const own = createApp({ apps: () => apps })
    const { id } = await store()
    // A version stored with a problem the engine reports now (a reference to a feature that isn't there).
    await apps.publish(
      id,
      'requests',
      modelWith(requests(), { feature: 'TableFeature', id: '3', inputs: { data_resource: '9' }, placement: { parent: '1', slot: 'content' } }),
    )
    await apps.publish(id, 'requests', modelWith(requests()))
    const refused = await own.request(`/api/v1/models/${id}/versions/1/publish`, json({}), env)
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ error: 'The model has problems to fix before it can be published' })
  })

  it('asks before an earlier version removes a table the app keeps rows in', async () => {
    const { id, revision } = await store(modelWith())
    await publish(id, revision, { slug: 'requests' })
    const added = await save(id, modelWith(requests()), revision)
    await publish(id, added)
    await request(`${at('requests')}/api/v1/app/tables/2/rows`, json({ title: 'Filed' }))
    const unconfirmed = await request(`/api/v1/models/${id}/versions/1/publish`, json({}))
    expect(unconfirmed.status).toBe(409)
    expect(((await unconfirmed.json()) as { problems: string[] }).problems).toEqual(['Confirm removing "Requests" (2) and its rows'])
    expect(await (await request(`/api/v1/models/${id}/versions/1/publish`, json({ removeTables: ['2'] }))).json()).toMatchObject({ version: 3 })
    expect(await new D1RowStore(d1.env.DB).countRows(id, 'live')).toEqual({})
  })
})

describe("an app's host", () => {
  it('serves the app page for every page path, and a 404 one where nothing is published', async () => {
    const { id, revision } = await store()
    await publish(id, revision, { slug: 'requests' })
    for (const path of ['/', '/models/7', '/requests?status=open']) {
      const page = await request(`${at('requests')}${path}`)
      expect(page.status, path).toBe(200)
      expect(await page.text(), path).toBe('<title>App</title>')
    }
    // A browser's navigation is a page, whatever the path looks like; so is a path that looks like a file but isn't one.
    const navigated = await request(`${at('requests')}/report.pdf`, { headers: { 'Sec-Fetch-Dest': 'document' } })
    expect(await navigated.text()).toBe('<title>App</title>')
    for (const path of ['/people/jane.doe', '/index.html', '/preview.html']) {
      const page = await request(`${at('requests')}${path}`)
      expect(page.status, path).toBe(200)
      expect(await page.text(), path).toBe('<title>App</title>')
    }
    expect((await request(`${at('requests')}/`)).headers.get('ETag')).toBe('"app-html"')
    const none = await request(`${at('nothing-here')}/`)
    expect(none.status).toBe(404)
    expect(await none.text()).toBe('<title>App</title>')
    // Kept by no cache, nor with a validator whose 304 would keep the 404 once an app is published there.
    expect(none.headers.get('ETag')).toBeNull()
    expect(none.headers.get('Cache-Control')).toBe('no-store')
    // Even to a browser revalidating the page it kept while the app was published.
    expect((await request(`${at('nothing-here')}/`, { headers: { 'If-None-Match': '"app-html"' } })).status).toBe(404)
    expect((await request(`${at('requests')}/`, { method: 'POST' })).status).toBe(405)
  })

  it("serves the build's files, but never the editor's page in place of a missing one", async () => {
    expect(await (await request(`${at('requests')}/assets/app-1.js`)).text()).toBe('export {}')
    // What a page loads (in development, Vite's modules, whatever their paths) is a file too.
    expect(await (await request(`${at('requests')}/assets/app-1.js`, { headers: { 'Sec-Fetch-Dest': 'script' } })).text()).toBe('export {}')
    // So is one a page fetches (`Sec-Fetch-Dest: empty`), from any path.
    expect(await (await request(`${at('requests')}/favicon.svg`, { headers: { 'Sec-Fetch-Dest': 'empty' } })).text()).toBe('<svg/>')
    for (const path of ['/assets/missing.js', '/index.html', '/preview.html']) {
      const missing = await request(`${at('requests')}${path}`, { headers: { 'Sec-Fetch-Dest': path.endsWith('.js') ? 'script' : 'iframe' } })
      expect(missing.status, path).toBe(404)
      expect(await missing.text(), path).toBe('Not found')
    }
    expect((await request(`${at('requests')}/assets/missing.js`)).status).toBe(404)
    expect((await request(`${at('requests')}/@vite/client`, { headers: { 'Sec-Fetch-Dest': 'script' } })).status).toBe(404)
  })

  it("reaches nothing of the builder's API", async () => {
    const { id, revision } = await store()
    await publish(id, revision, { slug: 'requests' })
    for (const path of ['/api/v1/models', `/api/v1/models/${id}`, `/api/v1/models/${id}/tables/2/rows`, '/api/v1/home/reset', '/api/v1/openapi.json']) {
      const answer = await request(`${at('requests')}${path}`)
      expect(answer.status, path).toBe(404)
      expect(await answer.json()).toEqual({ error: 'No such API endpoint' })
    }
    // Nor the builder's proxy: an app's is its own, for the published version.
    expect((await request(`${at('requests')}/api/v1/proxy`, json({ model: id, method: 'GET', url: 'https://example.com/' }))).status).toBe(404)
    const none = await request(`${at('nothing-here')}/api/v1/app`)
    expect(none.status).toBe(404)
    expect(await none.json()).toEqual({ error: 'No app is published at this address' })
  })

  it("never names a model itself: the app's proxy refuses one", async () => {
    const { id, revision } = await store()
    await publish(id, revision, { slug: 'requests' })
    const answer = await request(`${at('requests')}/api/v1/app/proxy`, json({ model: id, method: 'GET', url: 'https://example.com/' }))
    expect(answer.status).toBe(400)
    expect(await answer.json()).toEqual({ error: "An app's proxy fetches for the app itself: send no model" })
  })
})

describe("an app's proxy", () => {
  it("fetches only the published version's Server addresses, never the platform's own", async () => {
    const sent: string[] = []
    const own = createApp({ upstream: async (input) => (sent.push(String(input)), Response.json({ ok: true })) })
    const call = (url: string) => own.request(`${at('repos')}/api/v1/app/proxy`, json({ method: 'GET', url }), env)
    const server = (address: string): FeatureInstance => ({
      feature: 'DataResourceFeature',
      id: '4',
      inputs: { name: 'Repos', resource: address, operation: 'GET', fetch_through: 'server' },
    })
    const { id, revision } = await store(modelWith(server('https://api.example.com/repos')))
    await publish(id, revision, { slug: 'repos' })
    // The draft moves to another site; the app still fetches what it published.
    await save(id, modelWith(server('https://other.example.com/repos')), revision)
    expect((await call('https://api.example.com/repos/1')).status).toBe(200)
    expect((await call('https://other.example.com/repos')).status).toBe(403)
    const platform = await call('https://requests.localhost/api/v1/app')
    expect(platform.status).toBe(403)
    expect(sent).toEqual(['https://api.example.com/repos/1'])
  })
})

describe('hosts', () => {
  it("serves the editor's assets on the builder's host", async () => {
    expect(await (await request('/models/7')).text()).toBe('<title>Editor</title>')
  })

  it("sets the pages' security headers itself, on every page and file it passes on", async () => {
    const { id, revision } = await store()
    await publish(id, revision, { slug: 'requests' })
    for (const url of [
      `${BUILDER}/`,
      `${BUILDER}/models/7`,
      `${at('requests')}/`,
      `${at('requests')}/assets/app-1.js`,
      `${at('nothing-here')}/`,
      'http://example.com/',
    ]) {
      const headers = (await request(url)).headers
      for (const [name, value] of Object.entries(PAGE_HEADERS)) expect(headers.get(name), `${url} ${name}`).toBe(value)
    }
  })

  it("leaves the CSP off on Vite's development server, whose pages carry inline styles", () => {
    expect(pageHeaders()).toEqual(PAGE_HEADERS)
    const { 'Content-Security-Policy': _csp, ...others } = PAGE_HEADERS
    expect(pageHeaders(true)).toEqual(others)
  })

  it('answers nothing on any other host', async () => {
    for (const url of ['http://example.com/', 'http://example.com/api/v1/models', 'http://a.b.localhost/api/v1/app', 'http://requests_x.localhost/']) {
      const answer = await request(url)
      expect(answer.status, url).toBe(404)
      expect(await answer.text(), url).toBe('Not found')
    }
  })
})

describe("an app's host failing", () => {
  it('answers with the security headers, errors before its API is reached included', async () => {
    const apps = new MemoryAppStore()
    apps.bySlug = () => Promise.reject(new Error('secret detail'))
    const own = createApp({ apps: () => apps })
    const api = await own.request(`${at('requests')}/api/v1/app`, undefined, env)
    expect(api.status).toBe(500)
    expect(await api.text()).not.toContain('secret')
    for (const [name, value] of Object.entries(API_HEADERS)) expect(api.headers.get(name), name).toBe(value)
    const page = await own.request(`${at('requests')}/`, undefined, env)
    expect(page.status).toBe(500)
    for (const [name, value] of Object.entries(PAGE_HEADERS)) expect(page.headers.get(name), name).toBe(value)
  })
})
