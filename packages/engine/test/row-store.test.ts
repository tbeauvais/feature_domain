import { describe, expect, it } from 'vitest'
import { MemoryRowStore, rowBytes } from '../src'
import { describeRowStore } from './row-store-contract'

describeRowStore('MemoryRowStore', () => new MemoryRowStore())

describe('MemoryRowStore', () => {
  it('stamps rows with the time it is given', async () => {
    let now = Date.UTC(2026, 9, 24, 9, 30)
    const store = new MemoryRowStore(() => now)
    const table = { model: 'm', space: 'draft', table: '1' } as const
    const row = await store.create(table, { title: 'A' })
    expect(row).toMatchObject({ created_at: '2026-10-24T09:30:00.000Z', updated_at: '2026-10-24T09:30:00.000Z' })
    now += 60_000
    expect(await store.update(table, row.id, { title: 'B' })).toMatchObject({ created_at: '2026-10-24T09:30:00.000Z', updated_at: '2026-10-24T09:31:00.000Z' })
  })
})

describe('rowBytes', () => {
  it('counts the JSON in UTF-8', () => {
    expect(rowBytes({ t: 'ab' })).toBe(10)
    expect(rowBytes({ t: 'é' })).toBe(10)
    expect(rowBytes({ t: '€' })).toBe(11)
    expect(rowBytes({ t: '😀' })).toBe(12)
  })
})
