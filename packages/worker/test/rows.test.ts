import { MAX_TABLE_ROWS, MemoryModelStore, MemoryRowStore, sampleRowId, type AppModel, type FeatureInstance } from '@feature-domain/engine'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { API_HEADERS, createApp } from '../src/app'
import { MemoryAppStore } from '../src/apps'
import { MemoryAuthTables } from '../src/auth/store'
import { localD1, type LocalD1 } from './localD1'

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})

const requests = (inputs: Record<string, unknown> = {}): FeatureInstance => ({
  feature: 'DatabaseTableFeature',
  id: '2',
  inputs: {
    name: 'Requests',
    fields: ['title: text, required', 'details: long text', 'status: choice open | done, default open', 'hours: number'],
    sample_rows: '[{"title": "Paint the hall"}, {"title": "Fix the door", "status": "done"}]',
    ...inputs,
  },
})

const modelWith = (...features: FeatureInstance[]): AppModel => ({
  version: 2,
  name: 'Team requests',
  features: [{ feature: 'PageFeature', id: '1', inputs: { name: 'Home' }, placement: { parent: '$root', slot: 'content' } }, ...features],
})

let d1: LocalD1
beforeAll(async () => {
  d1 = await localD1()
}, 60_000)
afterAll(() => d1?.dispose())
beforeEach(() => d1.env.DB.exec('DELETE FROM models'))

const app = createApp()
const request = (path: string, init?: RequestInit) => app.request(path, init, d1.env)

/** Stores a model through the API and returns its rows' address. */
async function store(model: AppModel = modelWith(requests())): Promise<{ id: string; rows: string }> {
  const { id } = (await (await request('/api/v1/models', json(model))).json()) as { id: string }
  return { id, rows: `/api/v1/models/${id}/tables/2/rows` }
}

const titles = async (rows: string) => ((await (await request(rows)).json()) as { title: string }[]).map((r) => r.title)

describe('/api/v1/models/:id/tables/:table/rows', () => {
  it("lists the table's rows as a plain list, starting with its sample rows, stored once", async () => {
    const { rows } = await store()
    const listed = await request(rows)
    expect(listed.status).toBe(200)
    expect(listed.headers.get('Cache-Control')).toBe('no-store')
    for (const [name, value] of Object.entries(API_HEADERS)) expect(listed.headers.get(name)).toBe(value)
    const body = (await listed.json()) as Record<string, unknown>[]
    expect(body).toEqual([
      { id: sampleRowId(0), title: 'Paint the hall', status: 'open', created_at: expect.any(String), updated_at: expect.any(String) },
      { id: sampleRowId(1), title: 'Fix the door', status: 'done', created_at: expect.any(String), updated_at: expect.any(String) },
    ])
    // Emptying the table doesn't bring them back.
    for (const row of body) expect((await request(`${rows}/${row.id as string}`, { method: 'DELETE' })).status).toBe(204)
    expect(await (await request(rows)).json()).toEqual([])
  })

  it('adds a row: typed, with defaults, without keys the table lacks, and answers it with its address', async () => {
    const { rows } = await store()
    const created = await request(rows, json({ title: 'Order paper', hours: '1.5', id: 'mine', created_at: 'then', extra: true }))
    expect(created.status).toBe(201)
    const row = (await created.json()) as Record<string, unknown>
    expect(row).toEqual({
      id: expect.stringMatching(/^[0-7][0-9A-Z]{25}$/),
      title: 'Order paper',
      hours: 1.5,
      status: 'open',
      created_at: expect.any(String),
      updated_at: row.created_at,
    })
    expect(created.headers.get('Location')).toBe(`${rows}/${row.id as string}`)
    expect(await (await request(`${rows}/${row.id as string}`)).json()).toEqual(row)
    expect(await titles(rows)).toEqual(['Paint the hall', 'Fix the door', 'Order paper'])
  })

  it('changes only the fields sent, and empties the ones sent empty', async () => {
    const { rows } = await store()
    const { id } = (await (await request(rows, json({ title: 'Order paper', details: 'A4', hours: 2 }))).json()) as { id: string }
    const changed = await request(`${rows}/${id}`, json({ status: 'done', details: '' }, 'PATCH'))
    expect(changed.status).toBe(200)
    expect(await changed.json()).toMatchObject({ id, title: 'Order paper', status: 'done', hours: 2 })
    expect(await (await request(`${rows}/${id}`)).json()).not.toHaveProperty('details')
  })

  it('says what is wrong with a row, and changes nothing', async () => {
    const { rows } = await store()
    const bad = await request(rows, json({ details: 'no title', status: 'later' }))
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'The row is not valid', problems: ['title is required', 'status must be one of open, done'] })
    const row = (await (await request(rows)).json()) as { id: string }[]
    const emptied = await request(`${rows}/${row[0]!.id}`, json({ title: ' ' }, 'PATCH'))
    expect(await emptied.json()).toEqual({ error: 'The row is not valid', problems: ['title is required'] })
    expect((await request(rows, json('[1]'))).status).toBe(400)
    expect(await (await request(rows, json('{'))).json()).toEqual({ error: 'The body is not valid JSON' })
    // Only JSON, so a form on another site can't send a row.
    const form = await request(rows, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'title=x' })
    expect(form.status).toBe(415)
    expect(await titles(rows)).toEqual(['Paint the hall', 'Fix the door'])
  })

  it('answers 404 for a missing model, table or row, and for a table that is not a Database table', async () => {
    const { id, rows } = await store(modelWith(requests(), { feature: 'DataResourceFeature', id: '3', inputs: { name: 'Data' } }))
    const cases: [string, RequestInit | undefined, string][] = [
      ['/api/v1/models/nope/tables/2/rows', undefined, 'No model with this id'],
      [`/api/v1/models/${id}/tables/9/rows`, undefined, 'The model has no Database table with this id'],
      [`/api/v1/models/${id}/tables/3/rows`, undefined, 'The model has no Database table with this id'],
      [`/api/v1/models/${id}/tables/1/rows`, json({ title: 'x' }), 'The model has no Database table with this id'],
      [`${rows}/${sampleRowId(7)}`, undefined, 'No row with this id'],
      [`${rows}/not-an-id`, undefined, 'No row with this id'],
      [`${rows}/${sampleRowId(7)}`, json({ title: 'x' }, 'PATCH'), 'No row with this id'],
    ]
    for (const [path, init, message] of cases) {
      const response = await request(path, init)
      expect(response.status, path).toBe(404)
      expect(await response.json()).toEqual({ error: message })
    }
    // Deleting a missing row is not an error.
    expect((await request(`${rows}/${sampleRowId(7)}`, { method: 'DELETE' })).status).toBe(204)
  })

  it("keeps each model's rows apart, though their tables share a key", async () => {
    const a = await store()
    const b = await store(modelWith(requests({ sample_rows: '[]' })))
    await request(a.rows, json({ title: 'Only in A' }))
    expect(await titles(b.rows)).toEqual([])
    const [row] = (await (await request(a.rows)).json()) as { id: string }[]
    expect((await request(`${b.rows}/${row!.id}`)).status).toBe(404)
    await request(`${b.rows}/${row!.id}`, { method: 'DELETE' })
    expect(await titles(a.rows)).toHaveLength(3)
  })

  it('follows the stored model: a field added by a save is taken at once', async () => {
    const { id, rows } = await store()
    expect(await (await request(rows, json({ title: 'x', due: '2026-11-01' }))).json()).not.toHaveProperty('due')
    const fields = ['title: text, required', 'due: date']
    expect((await request(`/api/v1/models/${id}`, json(modelWith(requests({ fields })), 'PUT'))).status).toBe(204)
    expect(await (await request(rows, json({ title: 'y', due: '2026-11-01' }))).json()).toMatchObject({ due: '2026-11-01' })
  })

  it('refuses a row too large to keep, and a row past the last one a table holds', async () => {
    const { id, rows } = await store(modelWith(requests({ fields: ['a: long text', 'b: long text'], sample_rows: '[]' })))
    const big = await request(rows, json({ a: 'x'.repeat(9_000), b: 'y'.repeat(9_000) }))
    expect(big.status).toBe(413)
    expect(await big.json()).toEqual({ error: 'A row holds at most 16,384 bytes' })
    expect((await request(rows, json({ a: 'x'.repeat(70_000) }))).status).toBe(413)
    await d1.env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
       INSERT INTO rows (model_id, space, table_key, id, data, created_at, updated_at) SELECT ?, 'draft', '2', printf('%026d', i), '{}', i, i FROM n`,
    )
      .bind(MAX_TABLE_ROWS, id)
      .run()
    const full = await request(rows, json({ a: 'one more' }))
    expect(full.status).toBe(409)
    expect(await full.json()).toEqual({ error: 'A table holds at most 1,000 rows' })
  })

  it('deletes the rows of a table a save removes, so a new table under the same id starts with its own sample rows', async () => {
    const { id, rows } = await store()
    await request(rows, json({ title: 'Added' }))
    expect((await request(`/api/v1/models/${id}`, json(modelWith(), 'PUT'))).status).toBe(204)
    expect(await d1.env.DB.prepare('SELECT count(*) AS n FROM rows WHERE model_id = ?').bind(id).first<number>('n')).toBe(0)
    // The editor numbers a new feature after the highest id, so a table added now gets the removed one's id.
    const fresh = requests({ fields: ['name: text'], sample_rows: '[{"name": "New sample"}]' })
    await request(`/api/v1/models/${id}`, json(modelWith(fresh), 'PUT'))
    expect(await (await request(rows)).json()).toEqual([expect.objectContaining({ name: 'New sample' })])
  })

  it("keeps a table's rows while a save leaves it in the model, even when it has a problem", async () => {
    const { id, rows } = await store()
    await request(rows, json({ title: 'Added' }))
    await request(`/api/v1/models/${id}`, json(modelWith(requests({ fields: [] })), 'PUT'))
    await request(`/api/v1/models/${id}`, json(modelWith(requests()), 'PUT'))
    expect(await titles(rows)).toEqual(['Paint the hall', 'Fix the door', 'Added'])
  })

  it('stores sample rows on a request to the whole table, not to one row', async () => {
    const { rows } = await store()
    expect((await request(`${rows}/${sampleRowId(0)}`)).status).toBe(404)
    expect(await titles(rows)).toEqual(['Paint the hall', 'Fix the door'])
    expect((await request(`${rows}/${sampleRowId(0)}`)).status).toBe(200)
  })

  it('deletes the rows with their model', async () => {
    const { id, rows } = await store()
    await request(rows, json({ title: 'Added' }))
    expect((await request(`/api/v1/models/${id}`, { method: 'DELETE' })).status).toBe(204)
    expect(await d1.env.DB.prepare('SELECT count(*) AS n FROM rows WHERE model_id = ?').bind(id).first<number>('n')).toBe(0)
    expect((await request(rows)).status).toBe(404)
  })

  it('says which methods each address takes', async () => {
    const { rows } = await store()
    expect((await request(rows, { method: 'PUT' })).headers.get('Allow')).toBe('GET, POST')
    expect((await request(`${rows}/${sampleRowId(0)}`, { method: 'PUT' })).headers.get('Allow')).toBe('GET, PATCH, DELETE')
  })
})

describe("with stores of its own (the web tests' in-process API)", () => {
  it('deletes the rows with their model', async () => {
    const models = new MemoryModelStore()
    const rowStore = new MemoryRowStore()
    const apps = new MemoryAppStore()
    const authTables = new MemoryAuthTables()
    const own = createApp({ store: () => models, rows: () => rowStore, apps: () => apps, authTables: () => authTables })
    const id = await models.create(modelWith(requests()))
    const rows = `/api/v1/models/${id}/tables/2/rows`
    expect(await (await own.request(rows)).json()).toHaveLength(2)
    expect((await own.request(`/api/v1/models/${id}`, { method: 'DELETE' })).status).toBe(204)
    expect(await rowStore.list({ model: id, space: 'draft', table: '2' })).toEqual([])
  })

  it("answers a save that landed as saved, though removing a dropped table's rows failed", async () => {
    const models = new MemoryModelStore()
    const rowStore = new MemoryRowStore()
    const apps = new MemoryAppStore()
    const authTables = new MemoryAuthTables()
    rowStore.keepTables = () => Promise.reject(new Error('D1 is down'))
    const own = createApp({ store: () => models, rows: () => rowStore, apps: () => apps, authTables: () => authTables })
    const id = await models.create(modelWith(requests()))
    const saved = await own.request(`/api/v1/models/${id}`, json(modelWith(), 'PUT'))
    expect(saved.status).toBe(204)
    expect(saved.headers.get('ETag')).toBe('"2"')
  })
})
