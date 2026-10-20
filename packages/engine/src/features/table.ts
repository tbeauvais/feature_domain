import type { FeatureDefinition } from '../feature.js'
import { asInt, asList, asString, clamp, disableInput, nameInput } from '../inputs.js'
import { node } from '../nodes.js'
import type { NodeKinds, TableColumn } from '../types.js'
import { DATA_RESOURCE_TYPES, isDataResourceExports } from './data-resource.js'
import { actionFor, columnsFromRows, listSource, withInputs } from './sources.js'

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

    const listed = listSource(resolved.id, resource, asString(inputs.operation), ctx, 'a table')
    if (listed.source) {
      props.source = listed.source
      // Columns: the chosen fields, else a spec's, else the rows' keys.
      const fields = asList(inputs.fields)
      if (listed.schemaColumns && props.columns.length === 0) props.columns = listed.schemaColumns
      else if (props.columns.length === 0 && listed.source.rows) props.columns = columnsFromRows(listed.source.rows)
      // With no Fields of its own, Labels and Filters apply to these columns in order (e.g. "currency" for an amount).
      if (fields.length === 0) props.columns = withInputs(props.columns, asList(inputs.labels), asList(inputs.filters))
      // Columns only known once rows load (an address no spec describes): the renderer applies them then.
      const byPosition = { labels: asList(inputs.labels), filters: asList(inputs.filters) }
      if (fields.length === 0 && props.columns.length === 0 && (byPosition.labels.length > 0 || byPosition.filters.length > 0)) props.byPosition = byPosition
    }

    const deleteName = asString(inputs.delete_operation)
    if (deleteName) {
      const del = resource.operations.find((o) => o.name === deleteName)
      if (del) props.deleteAction = actionFor(resolved.id, resource, del)
      else ctx.report('warning', `Delete operation "${deleteName}" is not provided by ${resource.resource || resolved.id}`)
    }

    return { node: node('table', ctx.nodeId(), props) }
  },
}
