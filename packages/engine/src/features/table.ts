import type { FeatureDefinition } from '../feature.js'
import { asInt, asList, asString, clamp, disableInput, nameInput } from '../inputs.js'
import { node } from '../nodes.js'
import type { NodeKinds, TableColumn } from '../types.js'
import { DATA_RESOURCE_TYPES, isDataResourceExports, type DataOperation, type DataResourceExports, type DataSchema } from './data-resource.js'

/** A column per schema property, labelled by its description (without a closing full stop), else its name. */
function columnsOf(properties: NonNullable<DataSchema['properties']>): TableColumn[] {
  return Object.entries(properties).map(([field, p]) => ({ field, label: p.description?.trim().replace(/\.$/, '') || field }))
}

/**
 * When the operation's response schema contains an array of objects, the table shows that array (`path`) with one
 * column per item property, labelled by its description. This mirrors the legacy Swagger-driven behaviour.
 */
function fromSchema(resource: DataResourceExports, operation: DataOperation): { path: string; columns: TableColumn[] } | undefined {
  const response = operation.responseType && Object.hasOwn(resource.schemas, operation.responseType) ? resource.schemas[operation.responseType] : undefined
  // The response is itself a list (OpenAPI often says so): the table shows the whole response.
  if (response?.type === 'array' && response.items?.$ref) {
    const item = Object.hasOwn(resource.schemas, response.items.$ref) ? resource.schemas[response.items.$ref] : undefined
    if (item?.properties) return { path: '', columns: columnsOf(item.properties) }
  }
  for (const [key, property] of Object.entries(response?.properties ?? {})) {
    if (property.type !== 'array' || !property.items?.$ref) continue
    const item = Object.hasOwn(resource.schemas, property.items.$ref) ? resource.schemas[property.items.$ref] : undefined
    if (!item?.properties) continue
    const columns = columnsOf(item.properties)
    return { path: key, columns }
  }
  return undefined
}

/**
 * One column per key of the sample rows, in the order JavaScript lists them (first appearance, but integer-like keys
 * first), capped so wide rows stay readable. Labels read as words: "joined_on" is "Joined on".
 */
function fromRows(rows: readonly Record<string, unknown>[]): TableColumn[] {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((key) => key.trim() !== '').slice(0, 12)
  return keys.map((field) => {
    const words = field.replace(/[_-]+/g, ' ').trim()
    return { field, label: words ? words[0]!.toUpperCase() + words.slice(1) : field }
  })
}

function fromInputs(fields: string[], labels: string[], filters: string[]): TableColumn[] {
  return fields.map((field, i) => {
    const column: TableColumn = { field, label: labels[i] || field }
    if (filters[i]) column.filter = filters[i]
    return column
  })
}

export const TableFeature: FeatureDefinition = {
  type: 'TableFeature',
  name: 'Table',
  icon: 'table',
  placement: 'required',
  inputs: [
    nameInput(),
    disableInput,
    { name: 'title', label: 'Title', type: 'string', default: '', control: 'text-input' },
    {
      name: 'data_resource',
      label: 'Data Resource',
      type: 'reference',
      accepts: DATA_RESOURCE_TYPES,
      required: true,
      default: '',
      control: 'resource-select',
    },
    { name: 'operation', label: 'Operation', type: 'string', default: '', control: 'operation-select', methods: ['GET'] },
    { name: 'delete_operation', label: 'Delete Operation', type: 'string', default: '', control: 'operation-select', methods: ['DELETE'] },
    { name: 'fields', label: 'Fields', type: 'list', default: [], control: 'list-input' },
    { name: 'labels', label: 'Labels', type: 'list', default: [], control: 'list-input' },
    { name: 'filters', label: 'Filters', type: 'list', default: [], control: 'list-input' },
    // 0 shows every row. Stored tables without it show every row, as before; new ones scroll after 10.
    { name: 'scroll_rows', label: 'Scroll after (rows)', type: 'integer', default: 0, initial: 10, min: 0, max: 100, control: 'text-input' },
  ],

  generate(inputs, ctx) {
    const resolved = ctx.resolve(asString(inputs.data_resource))
    const props: NodeKinds['table'] = {
      columns: fromInputs(asList(inputs.fields), asList(inputs.labels), asList(inputs.filters)),
    }
    const title = asString(inputs.title).trim()
    if (title) props.title = title
    const scrollRows = clamp(asInt(inputs.scroll_rows, 0), 0, 100)
    if (scrollRows > 0) props.scrollRows = scrollRows
    if (!resolved || !isDataResourceExports(resolved.exports)) {
      ctx.report('error', 'Data resource did not export any operations')
      return { node: node('table', ctx.nodeId(), props) }
    }
    const resource = resolved.exports

    const operationName = asString(inputs.operation)
    const operation = resource.operations.find((o) => o.name === operationName) ?? (operationName ? undefined : resource.operations[0])
    if (operation?.sample && operation.method !== 'GET') {
      ctx.report('warning', `"${operation.name}" adds rows; a table lists them with the GET operation`)
    } else if (operation?.sample) {
      const rows = resource.sampleRows ?? []
      props.source = { feature: resolved.id, resource: resource.resource, operation: operation.name, endPoint: '', rows }
      // Columns: the chosen fields, else what a spec says the rows hold, else the sample rows' own keys.
      if (props.columns.length === 0) props.columns = fromSchema(resource, operation)?.columns ?? fromRows(rows)
    } else if (operation && !/^https?:\/\//i.test(operation.endPoint)) {
      ctx.report('warning', `Operation "${operation.name}" of ${resource.resource || resolved.id} has no http(s) URL`)
    } else if (operation) {
      const schema = fromSchema(resource, operation)
      props.source = { feature: resolved.id, resource: resource.resource, operation: operation.name, endPoint: operation.endPoint }
      if (schema) {
        if (schema.path) props.source.path = schema.path
        props.columns = schema.columns
      }
    } else {
      ctx.report('warning', `Operation "${operationName}" is not provided by ${resource.resource || resolved.id}`)
    }

    const deleteName = asString(inputs.delete_operation)
    if (deleteName) {
      const del = resource.operations.find((o) => o.name === deleteName)
      if (del?.sample) ctx.report('warning', `Sample data has no delete operation; "${deleteName}" is ignored`)
      else if (del) props.deleteAction = { operation: del.name, endPoint: del.endPoint }
      else ctx.report('warning', `Delete operation "${deleteName}" is not provided by ${resource.resource || resolved.id}`)
    }

    return { node: node('table', ctx.nodeId(), props) }
  },
}
