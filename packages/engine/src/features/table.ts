import type { FeatureDefinition } from '../feature.js'
import { asList, asString, disableInput, nameInput } from '../inputs.js'
import { node } from '../nodes.js'
import type { NodeKinds, TableColumn } from '../types.js'
import { DATA_RESOURCE_TYPES, isDataResourceExports, type DataResourceExports, type DataOperation } from './data-resource.js'

/**
 * When the operation's response schema contains an array of objects, the table shows that array (`path`) with one
 * column per item property, labelled by its description. This mirrors the legacy Swagger-driven behaviour.
 */
function fromSchema(resource: DataResourceExports, operation: DataOperation): { path: string; columns: TableColumn[] } | undefined {
  const response = operation.responseType ? resource.schemas[operation.responseType] : undefined
  for (const [key, property] of Object.entries(response?.properties ?? {})) {
    if (property.type !== 'array' || !property.items?.$ref) continue
    const item = resource.schemas[property.items.$ref]
    if (!item?.properties) continue
    const columns = Object.entries(item.properties).map(([field, p]) => ({ field, label: p.description || field }))
    return { path: key, columns }
  }
  return undefined
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
    {
      name: 'data_resource',
      label: 'Data Resource',
      type: 'reference',
      accepts: DATA_RESOURCE_TYPES,
      required: true,
      default: '',
      control: 'resource-select',
    },
    { name: 'operation', label: 'Operation', type: 'string', default: '', control: 'operation-select' },
    { name: 'delete_operation', label: 'Delete Operation', type: 'string', default: '', control: 'operation-select' },
    { name: 'fields', label: 'Fields', type: 'list', default: [], control: 'list-input' },
    { name: 'labels', label: 'Labels', type: 'list', default: [], control: 'list-input' },
    { name: 'filters', label: 'Filters', type: 'list', default: [], control: 'list-input' },
  ],

  generate(inputs, ctx) {
    const resolved = ctx.resolve(asString(inputs.data_resource))
    const props: NodeKinds['table'] = {
      columns: fromInputs(asList(inputs.fields), asList(inputs.labels), asList(inputs.filters)),
    }
    if (!resolved || !isDataResourceExports(resolved.exports)) {
      ctx.report('error', 'Data resource did not export any operations')
      return { node: node('table', ctx.nodeId(), props) }
    }
    const resource = resolved.exports

    const operationName = asString(inputs.operation)
    const operation = resource.operations.find((o) => o.name === operationName) ?? (operationName ? undefined : resource.operations[0])
    if (operation) {
      const schema = fromSchema(resource, operation)
      props.source = { feature: resolved.id, resource: resource.resource, operation: operation.name, endPoint: operation.endPoint }
      if (schema) {
        props.source.path = schema.path
        props.columns = schema.columns
      }
    } else {
      ctx.report('warning', `Operation "${operationName}" is not provided by ${resource.resource || resolved.id}`)
    }

    const deleteName = asString(inputs.delete_operation)
    if (deleteName) {
      const del = resource.operations.find((o) => o.name === deleteName)
      if (del) props.deleteAction = { operation: del.name, endPoint: del.endPoint }
      else ctx.report('warning', `Delete operation "${deleteName}" is not provided by ${resource.resource || resolved.id}`)
    }

    return { node: node('table', ctx.nodeId(), props) }
  },
}
