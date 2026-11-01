// The behavior every RowStore implementation must have. Each implementation's test file calls `describeRowStore` with a
// factory for a fresh, empty store (packages/worker imports this file too).

import { describe, expect, it } from 'vitest'
import { isRowId, MAX_ROW_BYTES, MAX_TABLE_ROWS, PersonForgottenError, RowLimitError, sampleRowId, type RowStore, type TableRef } from '../src'

const requests: TableRef = { model: 'm1', space: 'draft', table: '3' }
const values = (rows: readonly Record<string, unknown>[]) => rows.map(({ id: _id, created_at: _c, updated_at: _u, ...rest }) => rest)

export function describeRowStore(name: string, create: () => RowStore | Promise<RowStore>) {
  describe(`${name} (RowStore contract)`, () => {
    it('starts empty', async () => {
      const store = await create()
      expect(await store.list(requests)).toEqual([])
      expect(await store.get(requests, sampleRowId(0))).toBeNull()
    })

    it('adds rows with new ids and times, and lists them in the order they were added', async () => {
      const store = await create()
      const a = await store.create(requests, { title: 'First', done: false })
      const b = await store.create(requests, { title: 'Second', hours: 2.5 })
      expect(isRowId(a.id)).toBe(true)
      expect(a.id).not.toBe(b.id)
      expect(a).toMatchObject({ title: 'First', done: false })
      expect(a.created_at).toBe(a.updated_at)
      expect(new Date(a.created_at).toISOString()).toBe(a.created_at)
      expect(await store.list(requests)).toEqual([a, b])
      expect(await store.get(requests, b.id)).toEqual(b)
    })

    it('keeps each model, space and table apart', async () => {
      const store = await create()
      const row = await store.create(requests, { title: 'Draft' })
      for (const other of [
        { ...requests, model: 'm2' },
        { ...requests, space: 'live' as const },
        { ...requests, table: '4' },
      ]) {
        expect(await store.list(other)).toEqual([])
        expect(await store.get(other, row.id)).toBeNull()
        expect(await store.update(other, row.id, { title: 'No' })).toBeNull()
        await store.delete(other, row.id)
      }
      expect(await store.list(requests)).toEqual([row])
    })

    it('changes the given fields, removes cleared ones, keeps the rest, and moves updated_at only', async () => {
      const store = await create()
      const row = await store.create(requests, { title: 'Fix', status: 'open', note: 'soon' })
      const changed = await store.update(requests, row.id, { status: 'done' }, ['note'])
      expect(changed).toEqual({ id: row.id, created_at: row.created_at, updated_at: changed!.updated_at, title: 'Fix', status: 'done' })
      expect(changed!.updated_at >= row.updated_at).toBe(true)
      expect(await store.get(requests, row.id)).toEqual(changed)
      expect(await store.update(requests, sampleRowId(9), { status: 'done' })).toBeNull()
    })

    it('deletes rows, and deleting a missing row is not an error', async () => {
      const store = await create()
      const a = await store.create(requests, { title: 'A' })
      const b = await store.create(requests, { title: 'B' })
      await store.delete(requests, a.id)
      await store.delete(requests, a.id)
      expect(await store.list(requests)).toEqual([b])
    })

    it('never shares objects with the caller', async () => {
      const store = await create()
      const given = { title: 'A' }
      const row = await store.create(requests, given)
      given.title = 'changed'
      row.title = 'changed too'
      expect((await store.get(requests, row.id))?.title).toBe('A')
    })

    it(`refuses a row past ${MAX_ROW_BYTES} bytes, counting characters in UTF-8, on create and update`, async () => {
      const store = await create()
      // {"t":"…"} is 8 bytes around the text.
      const fits = await store.create(requests, { t: 'x'.repeat(MAX_ROW_BYTES - 8) })
      await expect(store.create(requests, { t: 'é'.repeat((MAX_ROW_BYTES - 8) / 2 + 1) })).rejects.toThrow(RowLimitError)
      await expect(store.update(requests, fits.id, { u: 'x' })).rejects.toMatchObject({ limit: 'bytes' })
      expect(await store.get(requests, fits.id)).toEqual(fits)
      expect(await store.list(requests)).toHaveLength(1)
    })

    it(`holds at most ${MAX_TABLE_ROWS} rows per table`, async () => {
      const store = await create()
      await store.storeSampleRows(
        requests,
        Array.from({ length: MAX_TABLE_ROWS - 1 }, (_, i) => ({ n: i })),
      )
      await store.create(requests, { n: 'last' })
      await expect(store.create(requests, { n: 'one more' })).rejects.toMatchObject({ limit: 'rows' })
      expect(await store.list(requests)).toHaveLength(MAX_TABLE_ROWS)
      expect(await store.list({ ...requests, table: '4' })).toEqual([])
      await store.create({ ...requests, table: '4' }, { n: 'other table' })
    })

    it('stores sample rows once, with fixed ids, and not again after they are deleted', async () => {
      const store = await create()
      expect(await store.storeSampleRows(requests, [{ title: 'One' }, { title: 'Two' }])).toBe(true)
      const rows = await store.list(requests)
      expect(rows.map((r) => r.id)).toEqual([sampleRowId(0), sampleRowId(1)])
      expect(values(rows)).toEqual([{ title: 'One' }, { title: 'Two' }])
      expect(await store.storeSampleRows(requests, [{ title: 'Again' }])).toBe(false)
      for (const row of rows) await store.delete(requests, row.id)
      expect(await store.storeSampleRows(requests, [{ title: 'Again' }])).toBe(false)
      expect(await store.list(requests)).toEqual([])
      // Each table has its own.
      expect(await store.storeSampleRows({ ...requests, space: 'live' }, [{ title: 'Live' }])).toBe(true)
    })

    it('stores sample rows once when asked twice at once', async () => {
      const store = await create()
      const stored = await Promise.all([store.storeSampleRows(requests, [{ title: 'One' }]), store.storeSampleRows(requests, [{ title: 'One' }])])
      expect(stored.filter(Boolean).length).toBeLessThanOrEqual(1)
      expect(values(await store.list(requests))).toEqual([{ title: 'One' }])
    })

    it("adds rows after the sample's, and stores sample rows after rows added first", async () => {
      const store = await create()
      const first = await store.create(requests, { title: 'Added first' })
      await store.storeSampleRows(requests, [{ title: 'Sample' }])
      const later = await store.create(requests, { title: 'Added later' })
      expect((await store.list(requests)).map((r) => r.title)).toEqual([first.title, 'Sample', later.title])
    })

    it("keeps only the given tables of a model's space: the others lose their rows and sample marks", async () => {
      const store = await create()
      const removed = { ...requests, table: '4' }
      await store.storeSampleRows(requests, [{ title: 'Kept' }])
      await store.storeSampleRows(removed, [{ title: 'Removed' }])
      const live = await store.create({ ...removed, space: 'live' }, { title: 'Live' })
      const other = await store.create({ ...removed, model: 'm2' }, { title: 'Other model' })
      await store.keepTables('m1', 'draft', ['3'])
      expect(values(await store.list(requests))).toEqual([{ title: 'Kept' }])
      expect(await store.list(removed)).toEqual([])
      expect(await store.list({ ...removed, space: 'live' })).toEqual([live])
      expect(await store.list({ ...removed, model: 'm2' })).toEqual([other])
      // A table added again under the same key starts over, with its own sample rows.
      expect(await store.storeSampleRows(removed, [{ title: 'New' }])).toBe(true)
      expect(values(await store.list(removed))).toEqual([{ title: 'New' }])
      expect(await store.storeSampleRows(requests, [{ title: 'Again' }])).toBe(false)
      await store.keepTables('m1', 'draft', [])
      expect(await store.list(requests)).toEqual([])
    })

    it("copies a model's space over another: its rows with their ids and times, and its sample marks", async () => {
      const store = await create()
      const live = { ...requests, space: 'live' as const }
      await store.storeSampleRows(requests, [{ title: 'Sample' }, { title: 'Deleted sample' }])
      const drafted = await store.list(requests)
      await store.delete(requests, drafted[1]!.id)
      const added = await store.create({ ...requests, table: '4' }, { title: 'Other table' })
      await store.create(live, { title: 'Replaced' })
      await store.storeSampleRows({ ...live, table: '9' }, [{ title: 'Replaced too' }])
      const otherModel = await store.create({ ...live, model: 'm2' }, { title: 'Other model' })
      await store.copySpace('m1', 'draft', 'live')
      expect(await store.list(live)).toEqual([drafted[0]])
      expect(await store.list({ ...live, table: '4' })).toEqual([added])
      expect(await store.list({ ...live, table: '9' })).toEqual([])
      expect(await store.list({ ...live, model: 'm2' })).toEqual([otherModel])
      // The draft's sample marks came along, so the deleted sample row doesn't come back; table 9 starts over.
      expect(await store.storeSampleRows(live, [{ title: 'Sample' }, { title: 'Deleted sample' }])).toBe(false)
      expect(await store.list(live)).toEqual([drafted[0]])
      expect(await store.storeSampleRows({ ...live, table: '9' }, [{ title: 'New' }])).toBe(true)
      // The copies are rows of their own: the draft's stay as they were.
      await store.update(live, drafted[0]!.id, { title: 'Changed live' })
      expect(await store.list(requests)).toEqual([drafted[0]])
      // Copying a space onto itself changes nothing; copying an empty one empties the other.
      await store.copySpace('m1', 'live', 'live')
      expect(values(await store.list(live))).toEqual([{ title: 'Changed live' }])
      await store.create({ ...live, model: 'm3' }, { title: 'Gone' })
      await store.copySpace('m3', 'draft', 'live')
      expect(await store.list({ ...live, model: 'm3' })).toEqual([])
    })

    it("counts a model's rows per table in one space", async () => {
      const store = await create()
      expect(await store.countRows('m1', 'draft')).toEqual({})
      await store.storeSampleRows(requests, [{ title: 'A' }, { title: 'B' }])
      await store.create({ ...requests, table: '4' }, { title: 'C' })
      const emptied = await store.create({ ...requests, table: '5' }, { title: 'D' })
      await store.delete({ ...requests, table: '5' }, emptied.id)
      await store.create({ ...requests, space: 'live' }, { title: 'Live' })
      await store.create({ ...requests, model: 'm2' }, { title: 'Other' })
      expect(await store.countRows('m1', 'draft')).toEqual({ '3': 2, '4': 1 })
      expect(await store.countRows('m1', 'live')).toEqual({ '3': 1 })
    })

    it("deletes a model's rows in every space and table, and its sample marks, leaving other models'", async () => {
      const store = await create()
      await store.storeSampleRows(requests, [{ title: 'Sample' }])
      await store.create({ ...requests, space: 'live' }, { title: 'Live' })
      await store.create({ ...requests, table: '4' }, { title: 'Other table' })
      const kept = await store.create({ ...requests, model: 'm2' }, { title: 'Other model' })
      await store.deleteModel('m1')
      expect(await store.list(requests)).toEqual([])
      expect(await store.list({ ...requests, space: 'live' })).toEqual([])
      expect(await store.list({ ...requests, table: '4' })).toEqual([])
      expect(await store.list({ ...requests, model: 'm2' })).toEqual([kept])
      // A model stored again under the same id starts over.
      expect(await store.storeSampleRows(requests, [{ title: 'Sample' }])).toBe(true)
    })

    it('remembers who added a row, lists only theirs when asked, and keeps it through changes', async () => {
      const store = await create()
      const live = { ...requests, space: 'live' as const }
      const ann = await store.create(live, { title: 'Ann’s' }, 'user-ann')
      const anon = await store.create(live, { title: 'Nobody’s' })
      const bo = await store.create(live, { title: 'Bo’s' }, 'user-bo')
      expect(ann.created_by).toBe('user-ann')
      expect(anon).not.toHaveProperty('created_by')
      expect(await store.get(live, ann.id)).toEqual(ann)
      expect(await store.list(live, { createdBy: 'user-ann' })).toEqual([ann])
      expect(await store.list(live, { createdBy: 'user-cy' })).toEqual([])
      expect(await store.list(live)).toEqual([ann, anon, bo])
      const changed = await store.update(live, ann.id, { title: 'Ann’s, changed' })
      expect(changed).toMatchObject({ created_by: 'user-ann', title: 'Ann’s, changed' })
    })

    it('gives a person’s rows by table, in one space and model', async () => {
      const store = await create()
      const live = { ...requests, space: 'live' as const }
      const a = await store.create(live, { title: 'A' }, 'user-ann')
      const b = await store.create({ ...live, table: '4' }, { title: 'B' }, 'user-ann')
      await store.create(live, { title: 'Bo’s' }, 'user-bo')
      await store.create(requests, { title: 'Draft' }, 'user-ann')
      await store.create({ ...live, model: 'm2' }, { title: 'Other app' }, 'user-ann')
      expect(await store.rowsBy('m1', 'live', 'user-ann')).toEqual({ '3': [a], '4': [b] })
      expect(await store.rowsBy('m1', 'live', 'user-cy')).toEqual({})
    })

    it('forgets a deleted person: their rows go, except in kept tables, where their name goes', async () => {
      const store = await create()
      const live = { ...requests, space: 'live' as const }
      const kept = { ...live, table: '4' }
      await store.create(live, { title: 'Ann’s' }, 'user-ann')
      const bo = await store.create(live, { title: 'Bo’s' }, 'user-bo')
      const shared = await store.create(kept, { title: 'Ann’s shared' }, 'user-ann')
      const otherApp = await store.create({ ...live, model: 'm2' }, { title: 'Other app' }, 'user-ann')
      await store.forgetPerson('m1', 'live', 'user-ann', ['4'])
      expect(await store.list(live)).toEqual([bo])
      const [left] = await store.list(kept)
      expect(left).toEqual({ ...shared, created_by: undefined })
      expect(left).not.toHaveProperty('created_by')
      expect(await store.rowsBy('m1', 'live', 'user-ann')).toEqual({})
      expect(await store.list({ ...live, model: 'm2' })).toEqual([otherApp])
    })

    it('copies who added each row when it copies a space', async () => {
      const store = await create()
      const row = await store.create(requests, { title: 'Draft' }, 'user-ann')
      await store.copySpace('m1', 'draft', 'live')
      expect(await store.list({ ...requests, space: 'live' })).toEqual([row])
    })

    it('changes or deletes a row only for the person who added it, when asked to check, and says whether it deleted', async () => {
      const store = await create()
      const live = { ...requests, space: 'live' as const }
      const row = await store.create(live, { title: 'Ann’s' }, 'user-ann')
      const anon = await store.create(live, { title: 'No one’s' })
      expect(await store.update(live, row.id, { title: 'Bo was here' }, [], { createdBy: 'user-bo' })).toBeNull()
      expect(await store.update(live, anon.id, { title: 'Bo was here' }, [], { createdBy: 'user-bo' })).toBeNull()
      expect(await store.delete(live, row.id, { createdBy: 'user-bo' })).toBe(false)
      expect(await store.list(live)).toEqual([row, anon])
      expect(await store.update(live, row.id, { title: 'Changed' }, [], { createdBy: 'user-ann' })).toMatchObject({ title: 'Changed' })
      expect(await store.delete(live, row.id, { createdBy: 'user-ann' })).toBe(true)
      expect(await store.delete(live, row.id)).toBe(false)
      expect(await store.delete(live, anon.id)).toBe(true)
    })

    it('adds no row in a forgotten person’s name afterwards, there only, and starts over for a model stored again', async () => {
      const store = await create()
      const live = { ...requests, space: 'live' as const }
      // Forgetting their rows before the account is deleted locks no one out (the deletion may yet fail).
      await store.forgetPerson('m1', 'live', 'user-ann', [])
      expect(await store.create(live, { title: 'Still here' }, 'user-ann')).toMatchObject({ created_by: 'user-ann' })
      await store.forgetPerson('m1', 'live', 'user-ann', [], true)
      expect(await store.list(live)).toEqual([])
      await expect(store.create(live, { title: 'Too late' }, 'user-ann')).rejects.toThrow(PersonForgottenError)
      expect(await store.list(live)).toEqual([])
      // Rows added by no one, by someone else, in the draft or in another model still are.
      await store.create(live, { title: 'No one’s' })
      await store.create(live, { title: 'Bo’s' }, 'user-bo')
      await store.create(requests, { title: 'Draft' }, 'user-ann')
      await store.create({ ...live, model: 'm2' }, { title: 'Other app' }, 'user-ann')
      expect(await store.list(live)).toHaveLength(2)
      await store.deleteModel('m1')
      expect(await store.create(live, { title: 'A new start' }, 'user-ann')).toMatchObject({ created_by: 'user-ann' })
    })

    it('takes any table key in its results by table, __proto__ and constructor included', async () => {
      const store = await create()
      const live = { ...requests, space: 'live' as const }
      for (const table of ['__proto__', 'constructor', 'toString']) await store.create({ ...live, table }, { title: table }, 'user-ann')
      const byTable = await store.rowsBy('m1', 'live', 'user-ann')
      expect(Object.keys(byTable).sort()).toEqual(['__proto__', 'constructor', 'toString'])
      expect(byTable['__proto__']).toEqual([expect.objectContaining({ title: '__proto__' })])
      const counts = await store.countRows('m1', 'live')
      expect(Object.keys(counts).sort()).toEqual(['__proto__', 'constructor', 'toString'])
      expect(counts['constructor']).toBe(1)
    })
  })
}
