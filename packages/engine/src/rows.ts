// Where a Database table's rows are kept. The Worker stores them in D1 (`D1RowStore`); `MemoryRowStore` is the
// reference implementation, and every implementation passes test/row-store-contract.ts.

import { sampleRowId, ulid, type FieldValue } from './tables.js'

/**
 * Which rows: the draft's (what the editor and the preview use) or, once a model is published, the live app's. The two
 * never mix, so trying a draft never touches live data.
 */
export const ROW_SPACES = ['draft', 'live'] as const
export type RowSpace = (typeof ROW_SPACES)[number]

/** One table's rows: the model, the space and the table's key (its instance id). */
export interface TableRef {
  model: string
  space: RowSpace
  table: string
}

/** A stored row: its field values, plus the id and times (ISO 8601) the store sets. */
export type StoredRow = { id: string; created_at: string; updated_at: string } & Record<string, FieldValue>

/** Values for a row, already checked against the table's fields (`validateRow`). */
export type RowValues = Record<string, FieldValue>

/** At most this many rows per table, and this many bytes of values per row (as JSON, in UTF-8). */
export const MAX_TABLE_ROWS = 1_000
export const MAX_ROW_BYTES = 16_384

/** A row that would go past a limit: the table's row count, or a row's size. Nothing is changed. */
export class RowLimitError extends Error {
  constructor(readonly limit: 'rows' | 'bytes') {
    super(
      limit === 'rows'
        ? `A table holds at most ${MAX_TABLE_ROWS.toLocaleString('en-US')} rows`
        : `A row holds at most ${MAX_ROW_BYTES.toLocaleString('en-US')} bytes`,
    )
    this.name = 'RowLimitError'
  }
}

export interface RowStore {
  /** The table's rows, in the order they were added. */
  list(table: TableRef): Promise<StoredRow[]>
  /** One row, or null. */
  get(table: TableRef, id: string): Promise<StoredRow | null>
  /** Adds a row with a new id and returns it. Throws `RowLimitError` past `MAX_TABLE_ROWS` or `MAX_ROW_BYTES`. */
  create(table: TableRef, values: RowValues): Promise<StoredRow>
  /**
   * Sets the given fields of a row and removes the `cleared` ones, keeping the rest, and returns it; null when there is
   * no such row. Throws `RowLimitError` when the row would pass `MAX_ROW_BYTES`.
   */
  update(table: TableRef, id: string, changes: RowValues, cleared?: readonly string[]): Promise<StoredRow | null>
  /** Deletes a row. Deleting a missing row is not an error. */
  delete(table: TableRef, id: string): Promise<void>
  /**
   * Stores a table's sample rows, once: the first call adds them (at most `MAX_TABLE_ROWS` in all, each with the id
   * `sampleRowId` gives its position, so two first calls at once still store each once) and returns true; every later
   * call, even after the rows were deleted, changes nothing and returns false.
   */
  storeSampleRows(table: TableRef, rows: readonly RowValues[]): Promise<boolean>
  /**
   * Deletes the rows of a model's tables in `space` whose keys aren't in `keys`, and forgets that they had their sample
   * rows: a Database table removed from the model takes its rows with it, so one added later under the same instance id
   * starts empty, with its own sample rows.
   */
  keepTables(model: string, space: RowSpace, keys: readonly string[]): Promise<void>
  /** Deletes every row of a model, in every space, and forgets which tables had their sample rows. */
  deleteModel(model: string): Promise<void>
}

/** How many bytes a row's values take as JSON in UTF-8 (what the store keeps). */
export function rowBytes(values: RowValues): number {
  let bytes = 0
  for (const char of JSON.stringify(values)) {
    const code = char.codePointAt(0)!
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}

const tableKey = (t: TableRef) => JSON.stringify([t.model, t.space, t.table])
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** An in-memory store, for tests and as the reference implementation of the contract. */
export class MemoryRowStore implements RowStore {
  private readonly tables = new Map<string, { ref: TableRef; rows: Map<string, StoredRow> }>()
  private readonly sampled = new Set<string>()
  private counter = 0

  constructor(
    private readonly now: () => number = Date.now,
    /** A new row id; by default a ULID whose randomness is a counter (tests can predict it; the Worker's are random). */
    private readonly newId: (time: number) => string = (time) => {
      const bytes = new Uint8Array(10)
      for (let i = 9, n = ++this.counter; i >= 0 && n > 0; i--, n = Math.floor(n / 256)) bytes[i] = n % 256
      return ulid(time, bytes)
    },
  ) {}

  private rowsOf(table: TableRef): Map<string, StoredRow> {
    const key = tableKey(table)
    let entry = this.tables.get(key)
    if (!entry) this.tables.set(key, (entry = { ref: { ...table }, rows: new Map() }))
    return entry.rows
  }

  async list(table: TableRef): Promise<StoredRow[]> {
    return copy([...(this.tables.get(tableKey(table))?.rows.values() ?? [])])
  }

  async get(table: TableRef, id: string): Promise<StoredRow | null> {
    const row = this.tables.get(tableKey(table))?.rows.get(id)
    return row ? copy(row) : null
  }

  async create(table: TableRef, values: RowValues): Promise<StoredRow> {
    const rows = this.rowsOf(table)
    if (rows.size >= MAX_TABLE_ROWS) throw new RowLimitError('rows')
    if (rowBytes(values) > MAX_ROW_BYTES) throw new RowLimitError('bytes')
    const time = this.now()
    const at = new Date(time).toISOString()
    const row = { ...copy(values), id: this.newId(time), created_at: at, updated_at: at } as StoredRow
    rows.set(row.id, row)
    return copy(row)
  }

  async update(table: TableRef, id: string, changes: RowValues, cleared: readonly string[] = []): Promise<StoredRow | null> {
    const rows = this.tables.get(tableKey(table))?.rows
    const stored = rows?.get(id)
    if (!rows || !stored) return null
    const { id: _id, created_at, updated_at: _updated, ...values } = stored
    const next: RowValues = { ...values, ...copy(changes) }
    for (const name of cleared) delete next[name]
    if (rowBytes(next) > MAX_ROW_BYTES) throw new RowLimitError('bytes')
    const row = { ...next, id, created_at, updated_at: new Date(this.now()).toISOString() } as StoredRow
    rows.set(id, row)
    return copy(row)
  }

  async delete(table: TableRef, id: string): Promise<void> {
    this.tables.get(tableKey(table))?.rows.delete(id)
  }

  async storeSampleRows(table: TableRef, sample: readonly RowValues[]): Promise<boolean> {
    const key = tableKey(table)
    if (this.sampled.has(key)) return false
    this.sampled.add(key)
    const rows = this.rowsOf(table)
    const at = new Date(this.now()).toISOString()
    sample.forEach((values, i) => {
      const id = sampleRowId(i)
      if (rows.size >= MAX_TABLE_ROWS || rows.has(id) || rowBytes(values) > MAX_ROW_BYTES) return
      rows.set(id, { ...copy(values), id, created_at: at, updated_at: at } as StoredRow)
    })
    return true
  }

  async keepTables(model: string, space: RowSpace, keys: readonly string[]): Promise<void> {
    this.forget(([m, s, table]) => m === model && s === space && !keys.includes(table!))
  }

  async deleteModel(model: string): Promise<void> {
    this.forget(([m]) => m === model)
  }

  /** Deletes the rows and sample marks of the tables `drop` picks, by their [model, space, table]. */
  private forget(drop: (ref: string[]) => boolean): void {
    for (const key of this.tables.keys()) if (drop(JSON.parse(key) as string[])) this.tables.delete(key)
    for (const key of this.sampled) if (drop(JSON.parse(key) as string[])) this.sampled.delete(key)
  }
}
