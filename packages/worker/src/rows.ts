// The rows API: a model's Database tables, read and written by its pages at /api/v1/models/:id/tables/:table/rows.

import {
  isRowId,
  RowLimitError,
  validateRow,
  type AppModel,
  type DatabaseTable,
  type RowStore,
  type ServerModelStore,
  type TableRef,
} from '@feature-domain/engine'

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
 * The table a request names, in the draft's rows (published apps get the live ones later): the stored model must have a
 * Database table with that key. With `sample`, its sample rows are stored if they never were: requests to the whole
 * table (list, add) do that; a request to one row needs an id it was given, so it skips the extra read.
 */
export async function tableOf(
  models: ServerModelStore,
  rows: RowStore,
  tablesOf: (id: string, revision: number, model: AppModel) => Map<string, DatabaseTable>,
  modelId: string,
  key: string,
  sample: boolean,
): Promise<{ ref: TableRef; table: DatabaseTable }> {
  const stored = await models.get(modelId)
  if (!stored) throw new RowsError(404, 'No model with this id')
  const table = tablesOf(modelId, stored.revision, stored.model).get(key)
  if (!table) throw new RowsError(404, 'The model has no Database table with this id')
  const ref: TableRef = { model: modelId, space: 'draft', table: key }
  if (sample) await rows.storeSampleRows(ref, table.sampleRows)
  return { ref, table }
}

/** A row id from the address: a ULID, else there is no such row. */
export function rowIdOf(id: string): string {
  if (!isRowId(id)) throw new RowsError(404, 'No row with this id')
  return id
}

/** The values a request sends for a row, checked against the table's fields (`partial` for a change). */
export async function readRow(request: Request, table: DatabaseTable, partial: boolean) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new RowsError(415, 'Send the row as application/json')
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
