import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { describeRowStore } from '../../engine/test/row-store-contract'
import { D1RowStore } from '../src/d1RowStore'
import { localD1, type LocalD1 } from './localD1'

let d1: LocalD1
beforeAll(async () => {
  d1 = await localD1()
}, 60_000)
afterAll(() => d1?.dispose())

/** An empty database. */
async function fresh(): Promise<void> {
  await d1.env.DB.exec('DELETE FROM rows; DELETE FROM sampled_tables')
}

describeRowStore('D1RowStore', async () => {
  await fresh()
  return new D1RowStore(d1.env.DB)
})

describe('D1RowStore', () => {
  const table = { model: 'm1', space: 'draft', table: '3' } as const

  it('takes who added a row from its column alone, never from a created_by key its data holds from before', async () => {
    await fresh()
    // A field once named created_by (before it was the row's own) left the key in the data.
    await d1.env.DB.prepare('INSERT INTO rows (model_id, space, table_key, id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind('m1', 'live', '3', '01JBQ0000000000000000000AA', JSON.stringify({ title: 'Old', created_by: 'user-ann' }), 1, 1)
      .run()
    const store = new D1RowStore(d1.env.DB)
    const live = { ...table, space: 'live' } as const
    const [row] = await store.list(live)
    expect(row).toEqual({ id: '01JBQ0000000000000000000AA', title: 'Old', created_at: expect.any(String), updated_at: expect.any(String) })
    expect(await store.delete(live, row!.id, { createdBy: 'user-ann' })).toBe(false)
  })

  it('keeps the order rows were added in, even within one millisecond', async () => {
    await fresh()
    const ids = ['01ZZZZZZZZ0000000000000000', '01AAAAAAAA0000000000000000', '01MMMMMMMM0000000000000000']
    const store = new D1RowStore(
      d1.env.DB,
      () => 1000,
      () => ids.shift()!,
    )
    for (const title of ['First', 'Second', 'Third']) await store.create(table, { title })
    expect((await store.list(table)).map((r) => r.title)).toEqual(['First', 'Second', 'Third'])
  })

  it('stores the values only, as JSON, and keeps changes to other fields made at the same time', async () => {
    await fresh()
    const store = new D1RowStore(d1.env.DB)
    const row = await store.create(table, { title: 'A', status: 'open', hours: 1 })
    const stored = await d1.env.DB.prepare('SELECT data FROM rows WHERE id = ?').bind(row.id).first<string>('data')
    expect(JSON.parse(stored!)).toEqual({ title: 'A', status: 'open', hours: 1 })
    await Promise.all([store.update(table, row.id, { status: 'done' }), store.update(table, row.id, { hours: 2 })])
    expect(await store.get(table, row.id)).toMatchObject({ title: 'A', status: 'done', hours: 2 })
  })
})
