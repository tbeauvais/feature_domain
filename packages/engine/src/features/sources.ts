// Where a data-reading feature (Table, Chart) gets its rows: the operation it lists, and what a spec says the rows hold.

import { operationRule, rowOperation } from '../access.js'
import type { FeatureContext } from '../feature.js'
import { isAppDataAddress, isModelsApiAddress } from '../links.js'
import type { DataAction, DataSource, TableColumn } from '../types.js'
import type { DataOperation, DataProperty, DataResourceExports, DataSchema } from './data-resource.js'
import { isDatabaseTableExports } from './database-table.js'

/** A column per schema property, labeled by its description (without a closing period), else its name. */
export function columnsOf(properties: NonNullable<DataSchema['properties']>): TableColumn[] {
  return Object.entries(properties).map(([field, p]) => ({ field, label: p.description?.trim().replace(/\.$/, '') || field }))
}

/**
 * What a spec says an operation lists: the array of objects in its response (`path`, empty when the response is itself
 * the list) and the properties each item has. This mirrors the legacy Swagger-driven behavior.
 */
export function listedRows(resource: DataResourceExports, operation: DataOperation): { path: string; properties: Record<string, DataProperty> } | undefined {
  const item = (ref?: string) => (ref && Object.hasOwn(resource.schemas, ref) ? resource.schemas[ref]?.properties : undefined)
  const response = operation.responseType && Object.hasOwn(resource.schemas, operation.responseType) ? resource.schemas[operation.responseType] : undefined
  // The response is itself a list (OpenAPI often says so): the table shows the whole response.
  const whole = response?.type === 'array' ? item(response.items?.$ref) : undefined
  if (whole) return { path: '', properties: whole }
  for (const [key, property] of Object.entries(response?.properties ?? {})) {
    const properties = property.type === 'array' ? item(property.items?.$ref) : undefined
    if (properties) return { path: key, properties }
  }
  return undefined
}

/** The table a spec describes: what its operation lists (`listedRows`), one column per item property. */
export function fromSchema(resource: DataResourceExports, operation: DataOperation): { path: string; columns: TableColumn[] } | undefined {
  const listed = listedRows(resource, operation)
  return listed && { path: listed.path, columns: columnsOf(listed.properties) }
}

/**
 * One column per key of the sample rows, in the order JavaScript lists them (first appearance, but integer-like keys
 * first), capped so wide rows stay readable. Labels read as words: "joined_on" is "Joined on".
 */
export function columnsFromRows(rows: readonly unknown[]): TableColumn[] {
  return fromRows(rows.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null && !Array.isArray(row)))
}

function fromRows(rows: readonly Record<string, unknown>[]): TableColumn[] {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((key) => key.trim() !== '').slice(0, 12)
  return keys.map((field) => ({ field, label: fieldLabel(field) }))
}

/** A field name read as words: "joined_on" is "Joined on" (the name itself when nothing is left). */
export function fieldLabel(field: string): string {
  const words = field.replace(/[_-]+/g, ' ').trim()
  return words ? words[0]!.toUpperCase() + words.slice(1) : field
}

/** Columns with labels and filters given by position (empty entries keep what the column has). */
export function withInputs(columns: readonly TableColumn[], labels: readonly string[], filters: readonly string[]): TableColumn[] {
  return columns.map((column, i) => {
    const out: TableColumn = { ...column }
    if (labels[i]) out.label = labels[i]!
    if (filters[i]) out.filter = filters[i]
    return out
  })
}

/**
 * The operation a feature uses when none is chosen: the first with the first of `methods`, else the first with the
 * next (a Form takes the first POST, else the first PUT). The inspector's "First (…)" option names the same one.
 */
export function defaultOperation(operations: readonly DataOperation[], methods: readonly string[]): DataOperation | undefined {
  for (const method of methods) {
    const operation = operations.find((o) => o.method === method)
    if (operation) return operation
  }
  return undefined
}

/**
 * The source a feature lists rows from: the chosen operation, or with none chosen the resource's first GET (as the
 * inspector's "First (…)" option says). Problems are reported in words naming `what` reads the rows. `schemaColumns`
 * is what a spec says the rows hold, when it says.
 */
export function listSource(
  resourceId: string,
  resource: DataResourceExports,
  operationName: string,
  ctx: Pick<FeatureContext, 'report'>,
  what: string,
  /** What the feature does with the answer, for its warnings: lists rows (a table, a chart) or reads values (a text). */
  reads: 'rows' | 'values' = 'rows',
): {
  source?: DataSource
  schemaColumns?: TableColumn[]
  /** What a spec says each listed row holds (e.g. the options a field takes). */
  rowProperties?: Record<string, DataProperty>
} {
  const name = resource.resource || resourceId
  const operation = operationName ? resource.operations.find((o) => o.name === operationName) : defaultOperation(resource.operations, ['GET'])
  const verb = reads === 'rows' ? 'list rows from' : 'read values from'
  if (!operationName && !operation && resource.operations.length > 0) ctx.report('warning', `${name} has no GET operation to ${verb}`)
  if (!operation) {
    if (operationName) ctx.report('warning', `Operation "${operationName}" is not provided by ${name}`)
    return {}
  }
  if (operation.sample && operation.method !== 'GET') {
    ctx.report('warning', `"${operation.name}" adds rows; ${what} ${reads === 'rows' ? 'lists them' : 'reads values'} with the GET operation`)
    return {}
  }
  const listed = listedRows(resource, operation)
  const schema = listed && { schemaColumns: columnsOf(listed.properties), rowProperties: listed.properties }
  if (operation.sample) {
    const source: DataSource = { feature: resourceId, resource: resource.resource, operation: operation.name, endPoint: '', rows: resource.sampleRows ?? [] }
    return { source, ...schema }
  }
  if (!isAddressOf(resource, operation.endPoint)) {
    ctx.report('warning', `Operation "${operation.name}" of ${name} has no http(s) URL`)
    return {}
  }
  const source: DataSource = { feature: resourceId, resource: resource.resource, operation: operation.name, endPoint: operation.endPoint }
  if (listed?.path) source.path = listed.path
  if (viaProxy(resource, operation)) source.proxy = true
  return { source, ...schema }
}

/** What a feature sends to an operation: its address, or the resource's sample rows. */
export function actionFor(resourceId: string, resource: DataResourceExports, operation: DataOperation): DataAction {
  const action: DataAction = {
    feature: resourceId,
    resource: resource.resource,
    operation: operation.name,
    method: operation.method,
    endPoint: operation.endPoint,
  }
  if (operation.sample) action.sample = true
  else if (viaProxy(resource, operation)) action.proxy = true
  if (operation.requestType) action.requestType = operation.requestType
  const ids = operation.sample && operation.method === 'POST' ? sampleIds(resource.sampleRows ?? []) : undefined
  if (ids) action.sampleIds = ids
  const operationOf = rowOperation(operation.method)
  if (isDatabaseTableExports(resource) && operationOf) {
    const rule = operationRule(resource.table.access, operationOf)
    if (rule !== 'anyone') action.rule = rule
  }
  return action
}

/**
 * An address a page reads or sends data to: http(s), the models API on this site (`isModelsApiAddress`), or a Database
 * table's rows, relative to the app (`isAppDataAddress`).
 */
export function isDataAddress(endPoint: string): boolean {
  return /^https?:\/\//i.test(endPoint) || isModelsApiAddress(endPoint) || isAppDataAddress(endPoint)
}

/**
 * Whether a resource's operation can be reached at its address: a data address, where a Database table's rows (relative
 * to the app) count only for the Database table itself, not as an address typed into another resource.
 */
export function isAddressOf(resource: DataResourceExports, endPoint: string): boolean {
  return isAppDataAddress(endPoint) ? 'table' in resource : isDataAddress(endPoint)
}

/** Whether the proxy fetches an operation: its resource says Server, and it isn't on this site (always the browser's). */
function viaProxy(resource: DataResourceExports, operation: DataOperation): boolean {
  return resource.fetchThrough === 'server' && !isModelsApiAddress(operation.endPoint)
}

/**
 * The id field of sample rows (an "id", else the first id-like field every row has) when its values are whole numbers
 * (or text of them), and the highest: what a server would number the next row from.
 */
function sampleIds(rows: readonly Record<string, unknown>[]): DataAction['sampleIds'] {
  if (rows.length === 0) return undefined
  const keys = Object.keys(rows[0]!)
  const field = keys.includes('id') ? 'id' : keys.find((k) => /^.+(_id|Id)$/.test(k))
  if (field === undefined || !rows.every((r) => Object.hasOwn(r, field))) return undefined
  const values = rows.map((r) => r[field])
  const numbers = values.map((v) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : Number.NaN))
  if (!numbers.every((n) => Number.isSafeInteger(n))) return undefined
  return { field, after: Math.max(...numbers), text: values.every((v) => typeof v === 'string') }
}
