import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { describeServerModelStore } from '../../engine/test/store-contract'
import { D1ModelStore } from '../src/d1ModelStore'
import { localD1, type LocalD1 } from './localD1'

let d1: LocalD1
beforeAll(async () => {
  d1 = await localD1()
}, 60_000)
afterAll(() => d1?.dispose())

// Each contract test gets an empty store; the database is shared, so it is emptied first.
describeServerModelStore('D1ModelStore', async () => {
  await d1.env.DB.exec('DELETE FROM models')
  return new D1ModelStore(d1.env.DB)
})

describe('D1ModelStore', () => {
  const model = { version: 2 as const, name: 'A', features: [] }

  it('keeps creation order for models created in the same millisecond', async () => {
    await d1.env.DB.exec('DELETE FROM models')
    const ids = ['c', 'a', 'b']
    const store = new D1ModelStore(
      d1.env.DB,
      () => ids.shift()!,
      () => 1000,
    )
    for (const name of ['First', 'Second', 'Third']) await store.create({ ...model, name })
    expect((await store.list()).map((m) => m.name)).toEqual(['First', 'Second', 'Third'])
  })

  it('stores the model without its id', async () => {
    await d1.env.DB.exec('DELETE FROM models')
    const id = await new D1ModelStore(d1.env.DB).create({ ...model, id: 'ignored' })
    const row = await d1.env.DB.prepare('SELECT model FROM models WHERE id = ?').bind(id).first<{ model: string }>()
    expect(JSON.parse(row!.model)).toEqual(model)
  })

  it('lists the time of the last save, and a put keeps the model where creation put it in the list', async () => {
    await d1.env.DB.exec('DELETE FROM models')
    let now = Date.UTC(2026, 9, 20, 8, 0)
    const ids = ['a', 'b']
    const store = new D1ModelStore(
      d1.env.DB,
      () => ids.shift()!,
      () => now,
    )
    await store.create({ ...model, name: 'First' })
    now += 60_000
    await store.put('home', { ...model, name: 'Home' })
    now += 60_000
    await store.create({ ...model, name: 'Last' })
    now += 60_000
    await store.put('home', { ...model, name: 'Home again' })
    expect(await store.list()).toEqual([
      { id: 'a', name: 'First', updatedAt: '2026-10-20T08:00:00.000Z' },
      { id: 'home', name: 'Home again', updatedAt: '2026-10-20T08:03:00.000Z' },
      { id: 'b', name: 'Last', updatedAt: '2026-10-20T08:02:00.000Z' },
    ])
  })
})
