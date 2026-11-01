import { accessNeedsSignIn, ADD_RULES, DELETED_ACCOUNT_ROWS, ROW_RULES, type TableAccess } from '../access.js'
import type { FeatureDefinition } from '../feature.js'
import type { InputValue } from '../types.js'
import { asList, asString, nameInput, type InputDef } from '../inputs.js'
import { isTableKey, tableRowsAddress } from '../links.js'
import { tableSchema, validateRow, type FieldValue, type TableField, type TableSchema } from '../tables.js'
import { MAX_SAMPLE_ROWS, parseSampleRows, type DataOperation, type DataParameter, type DataProperty, type DataResourceExports } from './data-resource.js'
import { SIGN_IN_FEATURE } from './sign-in.js'
import { fieldLabel } from './sources.js'

/** What a Database table exports: a data resource over its rows, plus the table itself for the Worker that stores them. */
export interface DatabaseTableExports extends DataResourceExports {
  table: {
    /** Where its rows are kept: the table's instance id, so renaming it keeps them. */
    key: string
    /** Its name (what a person's downloaded data calls it). */
    name: string
    schema: TableSchema
    /** The rows a new table starts with (stored once, the first time its rows are read), as stored. */
    sampleRows: Record<string, FieldValue>[]
    /** Who may see, add, change and delete its rows on the published app, and what a deleted account leaves. */
    access: TableAccess
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

const RULE_TEXT: Record<string, string> = { anyone: 'Anyone', 'signed-in': 'Signed in', owner: 'Owner', nobody: 'No one' }
const GROUP = 'Who can'

/** A rule's input: segmented, under "Who can". */
const ruleInput = (name: string, label: string, rules: readonly string[], hint: string): InputDef => ({
  name,
  label,
  type: 'string',
  default: 'anyone',
  control: 'segmented',
  options: rules.map((value) => ({ value, text: RULE_TEXT[value]! })),
  group: GROUP,
  hint,
})

/** The rule inputs, by operation. */
const RULE_INPUTS = [
  { input: 'see_rows', operation: 'see', rules: ROW_RULES, label: 'See rows' },
  { input: 'add_rows', operation: 'add', rules: ADD_RULES, label: 'Add rows' },
  { input: 'change_rows', operation: 'change', rules: ROW_RULES, label: 'Change rows' },
  { input: 'delete_rows', operation: 'delete', rules: ROW_RULES, label: 'Delete rows' },
] as const

/** The table's rules, read from its inputs. An unknown one is an error, and no one may do that (never opened by a typo). */
function readAccess(inputs: Readonly<Record<string, InputValue | undefined>>, report: (message: string) => void): TableAccess {
  const access = { deletedAccounts: 'delete' } as TableAccess
  for (const { input, operation, rules, label } of RULE_INPUTS) {
    const stored = asString(inputs[input])
    const known = (rules as readonly string[]).includes(stored)
    if (!known) report(`"${stored}" isn't a choice of who can ${label.toLowerCase()}: choose one`)
    ;(access as unknown as Record<string, string>)[operation] = known ? stored : 'nobody'
  }
  const kept = asString(inputs.deleted_accounts)
  if ((DELETED_ACCOUNT_ROWS as readonly string[]).includes(kept)) access.deletedAccounts = kept as TableAccess['deletedAccounts']
  else report(`"${kept}" isn't a choice of what happens to a deleted account's rows: choose one`)
  return access
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
      control: 'table-fields',
    },
    {
      name: 'sample_rows',
      label: 'Sample rows (JSON)',
      type: 'text',
      default: '[]',
      hint: 'The rows the table starts with, the first time it is read',
      control: 'json-area',
    },
    ruleInput('see_rows', 'See rows', ROW_RULES, 'On the published app. Owner: each person sees only the rows they added.'),
    ruleInput('add_rows', 'Add rows', ADD_RULES, 'Signed in: rows remember who added them, for Owner rules.'),
    ruleInput('change_rows', 'Change rows', ROW_RULES, 'Owner: only the person who added a row.'),
    ruleInput('delete_rows', 'Delete rows', ROW_RULES, 'Owner: only the person who added a row.'),
    {
      name: 'deleted_accounts',
      label: 'When someone deletes their account',
      type: 'string',
      default: 'delete',
      control: 'segmented',
      options: [
        { value: 'delete', text: 'Delete their rows' },
        { value: 'keep', text: 'Keep them, without their name' },
      ],
      group: GROUP,
      hint: 'Keep shared records, such as a team’s requests, when the person who added them leaves.',
    },
  ],

  // Rules that need someone signed in need sign-in: without it the published app would refuse everyone.
  requires(exports) {
    const access = isDatabaseTableExports(exports) ? exports.table.access : undefined
    if (!access || !accessNeedsSignIn(access)) return undefined
    return { feature: SIGN_IN_FEATURE, message: 'Its rules need people to sign in: add a Sign-in feature, or set them to Anyone or No one' }
  },

  generate(inputs, ctx) {
    const name = asString(inputs.name)
    const { schema, problems } = tableSchema(asList(inputs.fields))
    for (const problem of problems) ctx.report('warning', problem)
    if (schema.fields.length === 0) ctx.report('warning', 'The table has no fields: list them in Fields, like "name: text, required"')
    const key = ctx.instanceId
    const rows = sampleRows(asString(inputs.sample_rows), schema, (message) => ctx.report('warning', message))
    const access = readAccess(inputs, (message) => ctx.report('error', message))
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
      table: { key, name, schema, sampleRows: rows, access },
    }
    if (isTableKey(key)) exports.operations = operations(key, schema)
    else ctx.report('error', `The table's id "${key}" can't name where its rows are kept; give it an id of letters, digits, "_" or "-"`)
    return { exports: { ...exports } }
  },
}
