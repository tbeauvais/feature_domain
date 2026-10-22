import type { FeatureDefinition } from '../feature.js'
import { asBool, asInt, asString, clamp, disableInput, nameInput, type Inputs } from '../inputs.js'
import { node } from '../nodes.js'

export const MAX_COLUMNS = 12
export const MAX_ROWS = 50
/** The largest share a column width may have (shares are relative, so larger numbers add nothing). */
export const MAX_COLUMN_SHARE = 1000
/** Dragged column edges snap to this many parts of the row, and no column gets narrower than one. */
export const COLUMN_GRID = 12

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

/**
 * A Column widths input ("2, 1": relative shares of the row) as one share per column, or undefined for equal columns
 * (empty) or `'invalid'` (anything but whole numbers from 1 to `MAX_COLUMN_SHARE`). Missing shares take the mean of the
 * given ones, so adding a column gives it an ordinary width; extra shares are left out.
 */
export function parseColumnWidths(value: unknown, columns: number): number[] | undefined | 'invalid' {
  const text = asString(value).trim()
  if (text === '') return undefined
  const parts = text.split(',').map((p) => p.trim())
  if (!parts.every((p) => /^\d+$/.test(p) && Number(p) >= 1 && Number(p) <= MAX_COLUMN_SHARE)) return 'invalid'
  const given = parts.map(Number)
  const mean = Math.max(1, Math.round(given.reduce((a, b) => a + b, 0) / given.length))
  return Array.from({ length: columns }, (_, i) => given[i] ?? mean)
}

/** Shares as a Column widths input: "2, 1", or empty for equal columns (as a container without the input has). */
export const formatColumnWidths = (shares: readonly number[]) => (shares.every((s) => s === shares[0]) ? '' : shares.join(', '))

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

/** The smallest whole shares in the same proportions: 8, 4 -> 2, 1. */
export function reduceShares(shares: readonly number[]): number[] {
  const divisor = shares.reduce((a, b) => gcd(a, b), 0) || 1
  return shares.map((s) => s / divisor)
}

/** Where the edge after column `edge` (1-based) sits, as a fraction of the row's columns (gaps left out). */
export function columnEdgeFraction(shares: readonly number[], edge: number): number {
  const total = shares.reduce((a, b) => a + b, 0)
  return shares.slice(0, edge).reduce((a, b) => a + b, 0) / total
}

/**
 * The shares after moving the edge between columns `edge` and `edge + 1` (1-based) to `fraction` of the row. The edge
 * snaps to twelfths of the row, only the two columns beside it change, and neither gets narrower than a twelfth (when
 * one already is, the edge stays). Returns the smallest whole shares, e.g. "1, 1" with the edge at 2/3 -> 2, 1.
 */
export function moveColumnEdge(shares: readonly number[], edge: number, fraction: number): number[] {
  if (edge < 1 || edge >= shares.length || !Number.isFinite(fraction)) return [...shares]
  const total = shares.reduce((a, b) => a + b, 0)
  // Whole units in which both the shares and twelfths of the row are exact.
  const units = (total * COLUMN_GRID) / gcd(total, COLUMN_GRID)
  const unit = units / COLUMN_GRID
  const sized = shares.map((s) => (s * units) / total)
  const before = sized.slice(0, edge - 1).reduce((a, b) => a + b, 0)
  const after = before + sized[edge - 1]! + sized[edge]!
  const low = before + unit
  const high = after - unit
  if (low > high) return [...shares]
  const at = clamp(Math.round(fraction * COLUMN_GRID) * unit, low, high)
  sized[edge - 1] = at - before
  sized[edge] = after - at
  return reduceShares(sized)
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
    {
      name: 'column_widths',
      label: 'Column widths',
      type: 'string',
      default: '',
      placeholder: 'Equal',
      hint: 'Shares of the row, e.g. 2, 1 makes the first column twice as wide. You can also drag a column edge on the page.',
      control: 'column-widths',
      // Applied when the field is left: "2," on the way to "2, 1" would warn and flip the page to equal columns.
      commitOnBlur: true,
    },
    { name: 'rows', label: 'Rows', type: 'integer', default: 1, min: 1, max: MAX_ROWS, control: 'text-input' },
    { name: 'well', label: 'Add Well', type: 'boolean', default: true, control: 'checkbox-input' },
  ],

  slots: (inputs) => cells(inputs).map((c) => c.slot),

  generate(inputs, ctx) {
    const { rows, columns } = dimensions(inputs)
    const children = cells(inputs).map((c) => node('grid-cell', ctx.nodeId(c.slot), { row: c.row, column: c.column }, { slot: c.slot }))
    const props: { rows: number; columns: number; well: boolean; widths?: number[] } = { rows, columns, well: asBool(inputs.well) }
    const widths = parseColumnWidths(inputs.column_widths, columns)
    if (widths === 'invalid') ctx.report('warning', `Column widths should be whole numbers such as "2, 1"; using equal columns`)
    else if (widths && widths.some((w) => w !== widths[0])) props.widths = reduceShares(widths)
    return { node: node('grid', ctx.nodeId(), props, { children }) }
  },
}
