// The rows API: a model's Database tables, read and written by its pages: the draft's at
// /api/v1/models/:id/tables/:table/rows on the builder, a published app's at /api/v1/app/tables/:table/rows on its host.

import {
  isRowId,
  marksOwnRows,
  PersonForgottenError,
  RowLimitError,
  validateRow,
  type DatabaseTable,
  type RowOperation,
  type RowStore,
  type StoredRow,
  type TableRef,
} from '@feature-domain/engine'
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
 * The table a request names among a model version's Database tables (the draft's, or a published app's). Requests to the
 * whole table (list, add) then store its sample rows if they never were; a request to one row needs an id it was given,
 * so it skips the extra read.
 */
export function tableOf(tables: ReadonlyMap<string, DatabaseTable>, ref: TableRef): DatabaseTable {
  const table = tables.get(ref.table)
  if (!table) throw new RowsError(404, ref.space === 'live' ? 'The app has no Database table with this id' : 'The model has no Database table with this id')
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

/**
 * Where a rows request's table is: its row store, its place (model, space, key) and the tables of that model version.
 * On a published app, `visitor` says who asks (the person signed in, or null) and whether the app has sign-in, and the
 * table's rules apply; without it (the builder's draft rows) they don't.
 */
export interface RowsTarget {
  rowStore: RowStore
  ref: TableRef
  tables: ReadonlyMap<string, DatabaseTable>
  visitor?: { person: string | null; signIn: boolean }
}

/**
 * What the table's rule for `operation` lets this visitor do: refused (a 401 when signing in could help, else a 403), or
 * allowed, with the person signed in (undefined for no one, or where rules don't apply) and whether only their own rows
 * count (Owner).
 */
export function allowed(target: RowsTarget, table: DatabaseTable, operation: RowOperation): { person?: string; own: boolean } {
  const visitor = target.visitor
  if (!visitor) return { own: false }
  const person = visitor.person ?? undefined
  const rule = table.access[operation]
  if (rule === 'anyone') return { ...(person ? { person } : {}), own: false }
  if (rule === 'nobody') throw new RowsError(403, `No one can ${operation} this table's rows`)
  if (!visitor.signIn) throw new RowsError(403, `Only people signed in can ${operation} this table's rows, and this app has no sign-in`)
  if (!person) throw new RowsError(401, `Sign in to ${operation} this table's rows`)
  return { person, own: rule === 'owner' }
}

/**
 * Who a change or delete must have added the row for it to happen: the person signed in under an Owner rule, and also
 * where they may see only their own rows (no one changes what they can't see). Refused outright when they may not see
 * the table's rows at all, or not do this.
 */
// Answers to the rules `rulesFor` (in the engine) names for a change or delete: its own and See. appHost reads the
// session by the same function, so the two can't drift apart.
function writer(target: RowsTarget, table: DatabaseTable, operation: 'change' | 'delete'): { person?: string; owner?: string } {
  const see = allowed(target, table, 'see')
  const write = allowed(target, table, operation)
  const person = write.person ?? see.person
  return { ...(person ? { person } : {}), ...((write.own || see.own) && person ? { owner: person } : {}) }
}

/** Why a change or delete that touched nothing didn't: no such row (null), or another person's (a 404 where they can't see it, else a 403). */
async function untouched(target: RowsTarget, table: DatabaseTable, id: string, operation: 'change' | 'delete', person?: string): Promise<null> {
  const row = await target.rowStore.get(target.ref, id)
  if (!row) return null
  if (table.access.see === 'owner' && row.created_by !== person) throw new RowsError(404, 'No row with this id')
  throw new RowsError(403, `Only the person who added a row can ${operation} it`)
}

/**
 * A row as a page gets it: never with who added it (a person's id is theirs alone), except that where only a row's
 * owner may change or delete it (`marksOwnRows`), the visitor's own rows say so with their own id, so the page offers
 * them those controls.
 */
export function pageRow(row: StoredRow, person?: string, table?: DatabaseTable): StoredRow {
  const { created_by, ...rest } = row
  const mine = person !== undefined && created_by === person && table !== undefined && marksOwnRows(table.access)
  return (mine ? { ...rest, created_by } : rest) as StoredRow
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
  /** The table a request names (its sample rows are stored once its rules allow the request). */
  const resolve = async (c: Context) => {
    const found = await target(c)
    return { ...found, table: tableOf(found.tables, found.ref) }
  }

  // Rules are checked before anything is read or stored (a refused request never stores a table's sample rows).
  api.get(path, (c) =>
    rowsAnswer(async () => {
      const { table, ...found } = await resolve(c)
      const { person, own } = allowed(found, table, 'see')
      await found.rowStore.storeSampleRows(found.ref, table.sampleRows)
      const rows = await found.rowStore.list(found.ref, own ? { createdBy: person! } : {})
      return c.json(
        rows.map((row) => pageRow(row, person, table)),
        200,
        { 'Cache-Control': 'no-store' },
      )
    }),
  )

  api.post(path, limit, (c) =>
    rowsAnswer(async () => {
      const { table, ...found } = await resolve(c)
      const { person } = allowed(found, table, 'add')
      const { row } = await readRow(c.req.raw, table, false)
      await found.rowStore.storeSampleRows(found.ref, table.sampleRows)
      const created = await found.rowStore.create(found.ref, row, person)
      return c.json(pageRow(created, person, table), 201, { Location: location(found.ref, created.id) })
    }),
  )

  api.get(`${path}/:row`, (c) =>
    rowsAnswer(async () => {
      const { table, ...found } = await resolve(c)
      const { person, own } = allowed(found, table, 'see')
      const row = await found.rowStore.get(found.ref, rowIdOf(c.req.param('row')!))
      if (!row || (own && row.created_by !== person)) throw new RowsError(404, 'No row with this id')
      return c.json(pageRow(row, person, table), 200, { 'Cache-Control': 'no-store' })
    }),
  )

  // Under an Owner rule the write itself checks who added the row (RowStore's `createdBy`), so it can't change between a
  // check and the write.
  api.patch(`${path}/:row`, limit, (c) =>
    rowsAnswer(async () => {
      const { table, ...found } = await resolve(c)
      const id = rowIdOf(c.req.param('row')!)
      const { person, owner } = writer(found, table, 'change')
      const { row, cleared } = await readRow(c.req.raw, table, true)
      const changed = await found.rowStore.update(found.ref, id, row, cleared, owner ? { createdBy: owner } : {})
      if (!changed) {
        await untouched(found, table, id, 'change', person)
        throw new RowsError(404, 'No row with this id')
      }
      return c.json(pageRow(changed, person, table))
    }),
  )

  api.delete(`${path}/:row`, (c) =>
    rowsAnswer(async () => {
      const { table, ...found } = await resolve(c)
      const id = rowIdOf(c.req.param('row')!)
      const { person, owner } = writer(found, table, 'delete')
      // Deleting a missing row is not an error, whoever asks.
      if (!(await found.rowStore.delete(found.ref, id, owner ? { createdBy: owner } : {})) && owner) await untouched(found, table, id, 'delete', person)
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
    const answer =
      e instanceof RowLimitError ? limitError(e) : e instanceof PersonForgottenError ? new RowsError(401, 'Your account was deleted: sign in to add rows') : e
    if (answer instanceof RowsError) return error(answer.status, answer.message, answer.problems ? { problems: answer.problems } : {})
    throw e
  }
}
