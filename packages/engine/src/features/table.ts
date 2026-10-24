import { asInt, asList, asString, clamp, disableInput, nameInput } from '../inputs.js'
import { node } from '../nodes.js'
import type { FeatureContext, FeatureDefinition } from '../feature.js'
import type { NodeKinds, TableColumn } from '../types.js'
import { DATA_RESOURCE_TYPES, isDataResourceExports, type DataProperty } from './data-resource.js'
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
    // PATCH only: a PUT replaces the whole row, and the table sends the one field changed.
    { name: 'update_operation', label: 'Change Operation', type: 'string', default: '', control: 'operation-select', methods: ['PATCH'] },
    {
      name: 'change_fields',
      label: 'Changeable fields',
      type: 'list',
      default: [],
      placeholder: 'Every column with options',
      hint: 'Columns each row changes in place with a select of their options (e.g. a status), sent with the Change Operation',
      control: 'list-input',
      showWhen: { input: 'update_operation', notEquals: '' },
    },
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

    const updateName = asString(inputs.update_operation)
    if (updateName) {
      const update = resource.operations.find((o) => o.name === updateName)
      if (!update) ctx.report('warning', `Change operation "${updateName}" is not provided by ${resource.resource || resolved.id}`)
      else if (update.method !== 'PATCH') ctx.report('warning', `"${update.name}" doesn't change part of a row; rows are changed with PATCH`)
      else if (update.sample) ctx.report('warning', `"${update.name}" is answered with sample rows, which can't be changed in place`)
      else if (props.columns.length === 0)
        ctx.report('warning', "The table's columns are only known once its rows load, so it has no column with options to change: list them in Fields")
      else {
        props.updateAction = actionFor(resolved.id, resource, update)
        props.columns = changeable(props.columns, listed.rowProperties, asList(inputs.change_fields), ctx)
      }
    }

    return { node: node('table', ctx.nodeId(), props) }
  },
}

/**
 * The columns with the options each changeable one takes, from what the rows hold (`enum`): the Changeable fields, else
 * every column that has options. A listed field the table doesn't show, or that has no options, is a warning.
 */
function changeable(
  columns: TableColumn[],
  properties: Record<string, DataProperty> | undefined,
  fields: string[],
  ctx: Pick<FeatureContext, 'report'>,
): TableColumn[] {
  const optionsOf = (field: string) => {
    const property = properties && Object.hasOwn(properties, field) ? properties[field] : undefined
    return property?.enum && property.enum.length > 0 ? property.enum : undefined
  }
  for (const field of fields) {
    if (!columns.some((c) => c.field === field)) ctx.report('warning', `Changeable field "${field}" is not a column of the table`)
    else if (!optionsOf(field)) ctx.report('warning', `Changeable field "${field}" has no options to choose from`)
  }
  const out = columns.map((column) => {
    const options = (fields.length === 0 || fields.includes(column.field)) && optionsOf(column.field)
    return options ? { ...column, options: [...options] } : column
  })
  if (fields.length === 0 && !out.some((c) => c.options)) ctx.report('warning', 'No column has options to choose from, so rows have nothing to change')
  return out
}
