import type { FeatureDefinition } from '../feature.js'
import { asBool, asInt, clamp, disableInput, nameInput, type Inputs } from '../inputs.js'
import { node } from '../nodes.js'

export const MAX_COLUMNS = 12
const MAX_ROWS = 50

/** Slot key of a cell, e.g. row 1, column 2 -> "r1c2". */
export const cellSlot = (row: number, column: number) => `r${row}c${column}`

function dimensions(inputs: Inputs) {
  return {
    rows: clamp(asInt(inputs.rows, 1), 1, MAX_ROWS),
    columns: clamp(asInt(inputs.columns, 2), 1, MAX_COLUMNS),
  }
}

function cells(inputs: Inputs) {
  const { rows, columns } = dimensions(inputs)
  const out: { slot: string; row: number; column: number }[] = []
  for (let row = 1; row <= rows; row++) {
    for (let column = 1; column <= columns; column++) out.push({ slot: cellSlot(row, column), row, column })
  }
  return out
}

export const ContainerFeature: FeatureDefinition = {
  type: 'ContainerFeature',
  name: 'Container',
  icon: 'layout-grid',
  placement: 'required',
  inputs: [
    nameInput(),
    disableInput,
    { name: 'columns', label: 'Columns', type: 'integer', default: 2, min: 1, max: MAX_COLUMNS, control: 'text-input' },
    { name: 'rows', label: 'Rows', type: 'integer', default: 1, min: 1, max: MAX_ROWS, control: 'text-input' },
    { name: 'well', label: 'Add Well', type: 'boolean', default: true, control: 'checkbox-input' },
  ],

  slots: (inputs) => cells(inputs).map((c) => c.slot),

  generate(inputs, ctx) {
    const { rows, columns } = dimensions(inputs)
    const children = cells(inputs).map((c) => node('grid-cell', ctx.nodeId(c.slot), { row: c.row, column: c.column }, { slot: c.slot }))
    return { node: node('grid', ctx.nodeId(), { rows, columns, well: asBool(inputs.well) }, { children }) }
  },
}
