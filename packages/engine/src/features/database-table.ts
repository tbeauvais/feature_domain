import type { FeatureDefinition } from '../feature.js'
import { asList, asString, nameInput } from '../inputs.js'
import { isTableKey, tableRowsAddress } from '../links.js'
import { tableSchema, validateRow, type FieldValue, type TableField, type TableSchema } from '../tables.js'
import { MAX_SAMPLE_ROWS, parseSampleRows, type DataOperation, type DataParameter, type DataProperty, type DataResourceExports } from './data-resource.js'
import { fieldLabel } from './sources.js'

/** What a Database table exports: a data resource over its rows, plus the table itself for the Worker that stores them. */
export interface DatabaseTableExports extends DataResourceExports {
  table: {
    /** Where its rows are kept: the table's instance id, so renaming it keeps them. */
    key: string
    schema: TableSchema
    /** The rows a new table starts with (stored once, the first time its rows are read), as stored. */
    sampleRows: Record<string, FieldValue>[]
  }
}

export function isDatabaseTableExports(value: unknown): value is DatabaseTableExports {
  const table = (value as Partial<DatabaseTableExports> | undefined)?.table
  return typeof table === 'object' && table !== null && typeof table.key === 'string' && Array.isArray(table.schema?.fields)
}

/** The schema names of a table's row and its list of rows (one table per resource, so they can be fixed). */
const ROW_SCHEMA = 'Row'
const ROWS_SCHEMA = 'Rows'

function property(field: TableField): DataProperty {
  const out: DataProperty = { type: field.type === 'number' ? 'number' : field.type === 'yes-no' ? 'boolean' : 'string', description: fieldLabel(field.name) }
  if (field.options) out.enum = [...field.options]
  if (field.type === 'date' || field.type === 'long-text') out.format = field.type
  return out
}

/** A field as an operation's input: required in a new row unless it has a default; never in a change. */
function parameter(field: TableField, change: boolean): DataParameter {
  const p = property(field)
  const out: DataParameter = {
    name: field.name,
    in: 'body',
    type: p.type!,
    description: '',
    required: !change && field.required && field.default === undefined,
  }
  if (p.enum) out.enum = p.enum
  if (p.format) out.format = p.format
  if (!change && field.default !== undefined) out.default = field.default
  return out
}

const ID: DataParameter = { name: 'id', in: 'path', type: 'string', description: '', required: true }

/**
 * Its operations, named like sample data's (`GET rows`, `POST rows`, `DELETE rows`), so a Table or Form on sample data
 * keeps its operation when the resource becomes a Database table.
 */
function operations(key: string, schema: TableSchema): DataOperation[] {
  const rows = tableRowsAddress(key)
  const row = tableRowsAddress(key, '{id}')
  return [
    { name: 'GET rows', method: 'GET', endPoint: rows, responseType: ROWS_SCHEMA, summary: 'List the rows' },
    {
      name: 'POST rows',
      method: 'POST',
      endPoint: rows,
      responseType: ROW_SCHEMA,
      summary: 'Add a row',
      parameters: schema.fields.map((f) => parameter(f, false)),
    },
    {
      name: 'PATCH rows',
      method: 'PATCH',
      endPoint: row,
      responseType: ROW_SCHEMA,
      summary: 'Change fields of a row',
      parameters: [ID, ...schema.fields.map((f) => parameter(f, true))],
    },
    { name: 'DELETE rows', method: 'DELETE', endPoint: row, summary: 'Delete a row', parameters: [ID] },
  ]
}

/** The sample rows that fit the fields, as stored; the first problem of each that doesn't is reported. */
function sampleRows(text: string, schema: TableSchema, report: (message: string) => void): Record<string, FieldValue>[] {
  const parsed = parseSampleRows(text)
  if (parsed.problem) report(parsed.problem)
  if (parsed.rows.length > MAX_SAMPLE_ROWS) report(`Only the first ${MAX_SAMPLE_ROWS} of ${parsed.rows.length} sample rows are used`)
  const out: Record<string, FieldValue>[] = []
  parsed.rows.slice(0, MAX_SAMPLE_ROWS).forEach((values, i) => {
    const check = validateRow(schema, values)
    if (check.ok) out.push(check.row)
    else report(`Sample row ${i + 1} is left out: ${check.problems[0]!.message}`)
  })
  return out
}

/**
 * A table of rows kept by the app (in D1, by the Worker), defined by its fields. It is a data resource like any
 * other, so a Table lists its rows, a Form adds them and a Text counts them, with no address to set up.
 */
export const DatabaseTableFeature: FeatureDefinition = {
  type: 'DatabaseTableFeature',
  name: 'Database table',
  icon: 'database',
  placement: 'none',
  inputs: [
    nameInput(),
    {
      name: 'fields',
      label: 'Fields',
      type: 'list',
      default: [],
      initial: ['name: text, required', 'notes: long text'],
      placeholder: 'name: text, required',
      hint: 'One per line: name: type (text, long text, number, date, choice or yes/no), then "required" or "default …". A choice lists its options: status: choice open | done',
      control: 'list-input',
    },
    {
      name: 'sample_rows',
      label: 'Sample rows (JSON)',
      type: 'text',
      default: '[]',
      hint: 'The rows the table starts with, the first time it is read',
      control: 'json-area',
    },
  ],

  generate(inputs, ctx) {
    const name = asString(inputs.name)
    const { schema, problems } = tableSchema(asList(inputs.fields))
    for (const problem of problems) ctx.report('warning', problem)
    if (schema.fields.length === 0) ctx.report('warning', 'The table has no fields: list them in Fields, like "name: text, required"')
    const key = ctx.instanceId
    const rows = sampleRows(asString(inputs.sample_rows), schema, (message) => ctx.report('warning', message))
    const exports: DatabaseTableExports = {
      resource: name,
      operations: [],
      schemas: {
        [ROW_SCHEMA]: {
          type: 'object',
          properties: Object.fromEntries(schema.fields.map((f) => [f.name, property(f)])),
          // Required when sending a new row, as `POST rows` says: a field with a default can be left out.
          required: schema.fields.filter((f) => f.required && f.default === undefined).map((f) => f.name),
        },
        [ROWS_SCHEMA]: { type: 'array', items: { $ref: ROW_SCHEMA } },
      },
      table: { key, schema, sampleRows: rows },
    }
    if (isTableKey(key)) exports.operations = operations(key, schema)
    else ctx.report('error', `The table's id "${key}" can't name where its rows are kept; give it an id of letters, digits, "_" or "-"`)
    return { exports: { ...exports } }
  },
}
