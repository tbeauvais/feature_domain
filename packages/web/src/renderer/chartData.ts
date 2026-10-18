import { getPath, toText } from './filters'

/** At most this many points are drawn; a chart of more is unreadable anyway. */
export const MAX_CHART_POINTS = 100

export interface ChartData {
  labels: string[]
  values: number[]
  /** The fields used, chosen or guessed (absent when the rows have none that fit). */
  labelField?: string
  valueField?: string
  /** Rows left out: no number in the value field, or past MAX_CHART_POINTS. */
  skipped: number
}

/** A row value as a number: numbers, and text that is a plain decimal ("1204.5"), else undefined. */
export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) return Number(value)
  return undefined
}

const isId = (key: string) => /^(id|.+_id|.+Id)$/.test(key)

const keysOf = (rows: readonly unknown[]) => [
  ...new Set(rows.flatMap((row) => (typeof row === 'object' && row !== null && !Array.isArray(row) ? Object.keys(row) : []))),
]

/**
 * Chart points from rows: one per row, valued by `valueField` and labeled by `labelField`. A field that isn't given is
 * guessed from the rows: the first whose values are numbers, and the first short text one other than that (id-like
 * fields only when nothing else fits).
 */
export function chartData(rows: readonly unknown[], labelField?: string, valueField?: string): ChartData {
  // Ids ("id", "user_id", "nodeId") are numbers and opaque text, but rarely what anyone wants charted: they come last.
  const keys = keysOf(rows).sort((a, b) => Number(isId(a)) - Number(isId(b)))
  const numeric = (k: string) =>
    rows.some((r) => asNumber(getPath(r, k)) !== undefined) &&
    rows.every((r) => getPath(r, k) === undefined || getPath(r, k) === null || asNumber(getPath(r, k)) !== undefined)
  const value = valueField ?? keys.find(numeric)
  // A label reads best short: the first text field whose values are short, else any text field.
  const texts = keys.filter((k) => k !== value && rows.some((r) => typeof getPath(r, k) === 'string'))
  const label = labelField ?? texts.find((k) => rows.every((r) => toText(getPath(r, k)).length <= 40)) ?? texts[0]
  const out: ChartData = { labels: [], values: [], skipped: 0 }
  if (label !== undefined) out.labelField = label
  if (value !== undefined) out.valueField = value
  for (const [i, row] of rows.entries()) {
    const n = value === undefined ? undefined : asNumber(getPath(row, value))
    if (n === undefined || out.values.length >= MAX_CHART_POINTS) {
      out.skipped++
      continue
    }
    out.values.push(n)
    out.labels.push(label === undefined ? String(i + 1) : toText(getPath(row, label)) || String(i + 1))
  }
  return out
}
