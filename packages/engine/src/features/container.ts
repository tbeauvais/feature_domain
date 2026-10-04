import type { FeatureContext, FeatureDefinition } from '../feature'
import { node } from '../ids'
import { asBool, asInt, clamp, disableInput, nameInput, pageLocationInput, type Inputs } from '../inputs'

const MAX_COLUMNS = 12
const MAX_ROWS = 50

function dimensions(inputs: Inputs) {
  return {
    rows: clamp(asInt(inputs.rows, 1), 1, MAX_ROWS),
    columns: clamp(asInt(inputs.columns, 2), 1, MAX_COLUMNS),
  }
}

/** Cell target id, e.g. "container_my_container_12_row_1_col_2" (matches legacy models). */
export function cellId(domId: string, row: number, column: number): string {
  return `container_${domId}_row_${row}_col_${column}`
}

function cells(inputs: Inputs, ctx: FeatureContext) {
  const { rows, columns } = dimensions(inputs)
  const out: { id: string; row: number; column: number }[] = []
  for (let row = 1; row <= rows; row++) {
    for (let column = 1; column <= columns; column++) {
      out.push({ id: cellId(ctx.domId, row, column), row, column })
    }
  }
  return out
}

export const ContainerFeature: FeatureDefinition = {
  type: 'ContainerFeature',
  name: 'Container',
  icon: 'layout-grid',
  inputs: [
    nameInput(),
    disableInput,
    { name: 'columns', label: 'Columns', type: 'integer', default: 2, min: 1, max: MAX_COLUMNS, control: 'text-input' },
    { name: 'rows', label: 'Rows', type: 'integer', default: 1, min: 1, max: MAX_ROWS, control: 'text-input' },
    { name: 'well', label: 'Add Well', type: 'boolean', default: true, control: 'checkbox-input' },
    pageLocationInput,
  ],

  slots: (inputs, ctx) => cells(inputs, ctx).map((c) => c.id),

  generate(inputs, ctx) {
    const { rows, columns } = dimensions(inputs)
    return node(
      ctx.domId,
      'grid',
      { rows, columns, well: asBool(inputs.well) },
      cells(inputs, ctx).map((c) => node(c.id, 'grid-cell', { row: c.row, column: c.column })),
    )
  },
}
