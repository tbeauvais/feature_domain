// The rows API: a model's Database tables, read and written by its pages: the draft's at
// /api/v1/models/:id/tables/:table/rows on the builder, a published app's at /api/v1/app/tables/:table/rows on its host.

import { isRowId, RowLimitError, validateRow, type DatabaseTable, type RowStore, type TableRef } from '@feature-domain/engine'
import type { Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { error, sendsJson } from './http'

/** The largest request body the rows API reads: a row is at most MAX_ROW_BYTES once checked, with room for keys it drops. */
export const MAX_ROW_REQUEST_BYTES = 65_536

/** An answer the rows API sends instead: its status and message (and the row's problems). */
export class RowsError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly problems?: string[],
  ) {
    super(message)
    this.name = 'RowsError'
  }
}

/**
 * The table a request names among a model version's Database tables (the draft's, or a published app's), in that
 * version's space. With `sample`, its sample rows are stored if they never were: requests to the whole table (list, add)
 * do that; a request to one row needs an id it was given, so it skips the extra read.
 */
export async function tableOf(rows: RowStore, tables: ReadonlyMap<string, DatabaseTable>, ref: TableRef, sample: boolean): Promise<DatabaseTable> {
  const table = tables.get(ref.table)
  if (!table) throw new RowsError(404, ref.space === 'live' ? 'The app has no Database table with this id' : 'The model has no Database table with this id')
  if (sample) await rows.storeSampleRows(ref, table.sampleRows)
  return table
}

/** A row id from the address: a ULID, else there is no such row. */
export function rowIdOf(id: string): string {
  if (!isRowId(id)) throw new RowsError(404, 'No row with this id')
  return id
}

/** The values a request sends for a row, checked against the table's fields (`partial` for a change). */
export async function readRow(request: Request, table: DatabaseTable, partial: boolean) {
  if (!sendsJson(request)) throw new RowsError(415, 'Send the row as application/json')
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new RowsError(400, 'The body is not valid JSON')
  }
  const check = validateRow(table.schema, body, { partial })
  if (!check.ok)
    throw new RowsError(
      400,
      'The row is not valid',
      check.problems.map((p) => p.message),
    )
  return check
}

/** A store's limit, as the answer to send. */
export function limitError(e: RowLimitError): RowsError {
  return new RowsError(e.limit === 'bytes' ? 413 : 409, e.message)
}

/** Where a rows request's table is: its row store, its place (model, space, key) and the tables of that model version. */
export interface RowsTarget {
  rowStore: RowStore
  ref: TableRef
  tables: ReadonlyMap<string, DatabaseTable>
}

/**
 * The rows routes at `path` (`…/tables/:table/rows`, then `…/:row`): GET lists and POST adds, GET, PATCH and DELETE
 * one row; other methods get a 405. `target` finds the table a request names (throwing a `RowsError` when there is
 * none), and `location` is a new row's address. Reads are never cached. Bodies are JSON only, so a form on another site
 * can't send them.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each host's Hono app has its own environment type
export function mountRows<A extends Hono<any>>(
  api: A,
  path: string,
  target: (c: Context) => Promise<RowsTarget>,
  location: (ref: TableRef, id: string) => string,
) {
  const limit = bodyLimit({ maxSize: MAX_ROW_REQUEST_BYTES, onError: () => error(413, `Rows are sent in at most ${MAX_ROW_REQUEST_BYTES} bytes`) })
  /** The table, with its sample rows stored first when `sample`. */
  const resolve = async (c: Context, sample: boolean) => {
    const found = await target(c)
    return { ...found, table: await tableOf(found.rowStore, found.tables, found.ref, sample) }
  }

  api.get(path, (c) =>
    rowsAnswer(async () => {
      const { ref, rowStore } = await resolve(c, true)
      return c.json(await rowStore.list(ref), 200, { 'Cache-Control': 'no-store' })
    }),
  )

  api.post(path, limit, (c) =>
    rowsAnswer(async () => {
      const { ref, table, rowStore } = await resolve(c, true)
      const { row } = await readRow(c.req.raw, table, false)
      const created = await rowStore.create(ref, row)
      return c.json(created, 201, { Location: location(ref, created.id) })
    }),
  )

  api.get(`${path}/:row`, (c) =>
    rowsAnswer(async () => {
      const { ref, rowStore } = await resolve(c, false)
      const row = await rowStore.get(ref, rowIdOf(c.req.param('row')!))
      if (!row) throw new RowsError(404, 'No row with this id')
      return c.json(row, 200, { 'Cache-Control': 'no-store' })
    }),
  )

  api.patch(`${path}/:row`, limit, (c) =>
    rowsAnswer(async () => {
      const { ref, table, rowStore } = await resolve(c, false)
      const id = rowIdOf(c.req.param('row')!)
      const { row, cleared } = await readRow(c.req.raw, table, true)
      const changed = await rowStore.update(ref, id, row, cleared)
      if (!changed) throw new RowsError(404, 'No row with this id')
      return c.json(changed)
    }),
  )

  api.delete(`${path}/:row`, (c) =>
    rowsAnswer(async () => {
      const { ref, rowStore } = await resolve(c, false)
      await rowStore.delete(ref, rowIdOf(c.req.param('row')!))
      return c.body(null, 204)
    }),
  )

  api.all(path, () => error(405, 'Method not allowed', { allow: 'GET, POST' }))
  api.all(`${path}/:row`, () => error(405, 'Method not allowed', { allow: 'GET, PATCH, DELETE' }))
}

/** Runs a rows route, sending its `RowsError` (or a store's limit) as the error answer. */
async function rowsAnswer(route: () => Promise<Response>): Promise<Response> {
  try {
    return await route()
  } catch (e) {
    const answer = e instanceof RowLimitError ? limitError(e) : e
    if (answer instanceof RowsError) return error(answer.status, answer.message, answer.problems ? { problems: answer.problems } : {})
    throw e
  }
}
