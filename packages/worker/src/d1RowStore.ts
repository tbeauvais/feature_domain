import {
  MAX_ROW_BYTES,
  MAX_TABLE_ROWS,
  RowLimitError,
  rowBytes,
  sampleRowId,
  ulid,
  type OwnedBy,
  type RowSpace,
  type RowStore,
  type RowValues,
  type StoredRow,
  type TableRef,
} from '@feature-domain/engine'

interface RowRecord {
  id: string
  data: string
  created_at: number
  updated_at: number
  created_by: string | null
}

const COLUMNS = 'id, data, created_at, updated_at, created_by'
/** Where a table's rows are: its model, space and key, bound in that order. */
const OF_TABLE = 'model_id = ? AND space = ? AND table_key = ?'
const of = (t: TableRef) => [t.model, t.space, t.table] as const

/** A stored row: who added it is the column alone (a `created_by` key in the data, from a field of that name before it was the row's, is dropped). */
const toRow = (r: RowRecord): StoredRow => {
  const { created_by: _, ...data } = JSON.parse(r.data) as RowValues
  return {
    ...data,
    id: r.id,
    created_at: new Date(r.created_at).toISOString(),
    updated_at: new Date(r.updated_at).toISOString(),
    ...(r.created_by === null ? {} : { created_by: r.created_by }),
  } as StoredRow
}

/** The clause and value that keep a write to the rows `options.createdBy` added, if given. */
const ownedBy = (options: OwnedBy): [string, string[]] => (options.createdBy === undefined ? ['', []] : [' AND created_by = ?', [options.createdBy]])

/** A random ULID: the time, then 80 bits from the platform's random source. */
const randomId = (time: number) => ulid(time, crypto.getRandomValues(new Uint8Array(10)))

/**
 * Database tables' rows in D1 (migrations/0003_rows.sql). Each statement that changes rows checks its limit itself, so
 * two requests at once can't pass it: an insert counts the table's rows in the same statement, an update measures the
 * merged row.
 */
export class D1RowStore implements RowStore {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => number = Date.now,
    private readonly newId: (time: number) => string = randomId,
  ) {}

  async list(table: TableRef, options: { createdBy?: string } = {}): Promise<StoredRow[]> {
    const by = options.createdBy === undefined ? '' : ' AND created_by = ?'
    const { results } = await this.db
      .prepare(`SELECT ${COLUMNS} FROM rows WHERE ${OF_TABLE}${by} ORDER BY created_at, rowid`)
      .bind(...of(table), ...(options.createdBy === undefined ? [] : [options.createdBy]))
      .all<RowRecord>()
    return results.map(toRow)
  }

  async get(table: TableRef, id: string): Promise<StoredRow | null> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM rows WHERE ${OF_TABLE} AND id = ?`)
      .bind(...of(table), id)
      .first<RowRecord>()
    return row ? toRow(row) : null
  }

  async create(table: TableRef, values: RowValues, createdBy?: string): Promise<StoredRow> {
    if (rowBytes(values) > MAX_ROW_BYTES) throw new RowLimitError('bytes')
    const at = this.now()
    const row = await this.db
      .prepare(
        `INSERT INTO rows (model_id, space, table_key, id, data, created_at, updated_at, created_by)
         SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT count(*) FROM rows WHERE ${OF_TABLE}) < ?
         RETURNING ${COLUMNS}`,
      )
      .bind(...of(table), this.newId(at), JSON.stringify(values), at, at, createdBy ?? null, ...of(table), MAX_TABLE_ROWS)
      .first<RowRecord>()
    if (!row) throw new RowLimitError('rows')
    return toRow(row)
  }

  async update(table: TableRef, id: string, changes: RowValues, cleared: readonly string[] = [], options: OwnedBy = {}): Promise<StoredRow | null> {
    // A JSON merge patch (null removes a key), applied by D1 in the one statement, so changes to other fields made at
    // the same time are kept. An owner, when given, is checked in it too.
    const patch = JSON.stringify({ ...changes, ...Object.fromEntries(cleared.map((name) => [name, null])) })
    const [owned, owner] = ownedBy(options)
    const row = await this.db
      .prepare(
        `UPDATE rows SET data = json_patch(data, ?), updated_at = ? WHERE ${OF_TABLE} AND id = ?${owned}
         AND length(CAST(json_patch(data, ?) AS BLOB)) <= ? RETURNING ${COLUMNS}`,
      )
      .bind(patch, this.now(), ...of(table), id, ...owner, patch, MAX_ROW_BYTES)
      .first<RowRecord>()
    if (row) return toRow(row)
    const stored = await this.get(table, id)
    if (stored && (options.createdBy === undefined || stored.created_by === options.createdBy)) throw new RowLimitError('bytes')
    return null
  }

  async delete(table: TableRef, id: string, options: OwnedBy = {}): Promise<boolean> {
    const [owned, owner] = ownedBy(options)
    const { meta } = await this.db
      .prepare(`DELETE FROM rows WHERE ${OF_TABLE} AND id = ?${owned}`)
      .bind(...of(table), id, ...owner)
      .run()
    return meta.changes > 0
  }

  async storeSampleRows(table: TableRef, sample: readonly RowValues[]): Promise<boolean> {
    // Read first: once a table's sample rows are stored (nearly always), this costs no write.
    const marked = await this.db
      .prepare(`SELECT 1 FROM sampled_tables WHERE ${OF_TABLE}`)
      .bind(...of(table))
      .first()
    if (marked) return false
    // One batch (a transaction): the mark, then the rows only if this batch made the mark (its token), with their fixed
    // ids, up to the table's limit.
    const token = crypto.randomUUID()
    const at = this.now()
    const rows = sample.map((values, i) => ({ id: sampleRowId(i), data: values })).filter((r) => rowBytes(r.data) <= MAX_ROW_BYTES)
    const [mark] = await this.db.batch([
      this.db.prepare('INSERT INTO sampled_tables (model_id, space, table_key, token) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING').bind(...of(table), token),
      this.db
        .prepare(
          `INSERT OR IGNORE INTO rows (model_id, space, table_key, id, data, created_at, updated_at)
           SELECT ?, ?, ?, json_extract(value, '$.id'), json(json_extract(value, '$.data')), ?, ? FROM json_each(?)
           WHERE EXISTS (SELECT 1 FROM sampled_tables WHERE ${OF_TABLE} AND token = ?)
           LIMIT max(0, ? - (SELECT count(*) FROM rows WHERE ${OF_TABLE}))`,
        )
        .bind(...of(table), at, at, JSON.stringify(rows), ...of(table), token, MAX_TABLE_ROWS, ...of(table)),
    ])
    return (mark?.meta.changes ?? 0) > 0
  }

  async keepTables(model: string, space: RowSpace, keys: readonly string[]): Promise<void> {
    const others = 'model_id = ? AND space = ? AND table_key NOT IN (SELECT value FROM json_each(?))'
    const bind = [model, space, JSON.stringify(keys)] as const
    await this.db.batch([
      this.db.prepare(`DELETE FROM rows WHERE ${others}`).bind(...bind),
      this.db.prepare(`DELETE FROM sampled_tables WHERE ${others}`).bind(...bind),
    ])
  }

  async copySpace(model: string, from: RowSpace, to: RowSpace): Promise<void> {
    if (from === to) return
    // One batch (a transaction): `to` is cleared, then gets `from`'s rows and sample marks as they are.
    const space = 'model_id = ? AND space = ?'
    await this.db.batch([
      this.db.prepare(`DELETE FROM rows WHERE ${space}`).bind(model, to),
      this.db.prepare(`DELETE FROM sampled_tables WHERE ${space}`).bind(model, to),
      this.db
        .prepare(
          `INSERT INTO rows (model_id, space, table_key, id, data, created_at, updated_at, created_by)
           SELECT model_id, ?, table_key, id, data, created_at, updated_at, created_by FROM rows WHERE ${space} ORDER BY created_at, rowid`,
        )
        .bind(to, model, from),
      this.db
        .prepare(`INSERT INTO sampled_tables (model_id, space, table_key, token) SELECT model_id, ?, table_key, token FROM sampled_tables WHERE ${space}`)
        .bind(to, model, from),
    ])
  }

  async rowsBy(model: string, space: RowSpace, person: string): Promise<Record<string, StoredRow[]>> {
    const { results } = await this.db
      .prepare(`SELECT table_key, ${COLUMNS} FROM rows WHERE model_id = ? AND space = ? AND created_by = ? ORDER BY table_key, created_at, rowid`)
      .bind(model, space, person)
      .all<RowRecord & { table_key: string }>()
    const out: Record<string, StoredRow[]> = {}
    for (const { table_key, ...row } of results) (out[table_key] ??= []).push(toRow(row))
    return out
  }

  async forgetPerson(model: string, space: RowSpace, person: string, keep: readonly string[]): Promise<void> {
    // One batch (a transaction): kept tables' rows lose the name, then the person's other rows go.
    const theirs = 'model_id = ? AND space = ? AND created_by = ?'
    const kept = 'table_key IN (SELECT value FROM json_each(?))'
    const bind = [model, space, person, JSON.stringify(keep)] as const
    await this.db.batch([
      this.db.prepare(`UPDATE rows SET created_by = NULL WHERE ${theirs} AND ${kept}`).bind(...bind),
      this.db.prepare(`DELETE FROM rows WHERE ${theirs} AND NOT ${kept}`).bind(...bind),
    ])
  }

  async countRows(model: string, space: RowSpace): Promise<Record<string, number>> {
    const { results } = await this.db
      .prepare('SELECT table_key, count(*) AS n FROM rows WHERE model_id = ? AND space = ? GROUP BY table_key')
      .bind(model, space)
      .all<{ table_key: string; n: number }>()
    return Object.fromEntries(results.map((r) => [r.table_key, r.n]))
  }

  async deleteModel(model: string): Promise<void> {
    await this.db.batch([
      this.db.prepare('DELETE FROM rows WHERE model_id = ?').bind(model),
      this.db.prepare('DELETE FROM sampled_tables WHERE model_id = ?').bind(model),
    ])
  }
}
