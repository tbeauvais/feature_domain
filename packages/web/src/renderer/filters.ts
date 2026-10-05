// Display filters for table cells. Legacy models used AngularJS filter expressions ("uppercase", "date",
// "dataLink :data.html_url"); this is a small, safe language with the same names: `name` or `name :argument`.

import { safeHref } from './urls'

export interface CellContent {
  text: string
  /** Set when the cell is a link. Only http(s) URLs are ever returned. */
  href?: string
}

export interface FilterSpec {
  name: string
  argument?: string
}

export function parseFilter(spec: string | undefined): FilterSpec | undefined {
  const match = /^\s*([A-Za-z]\w*)\s*(?::\s*(.*?))?\s*$/.exec(spec ?? '')
  if (!match) return undefined
  return match[2] ? { name: match[1]!, argument: match[2] } : { name: match[1]! }
}

/** Reads a dotted path such as "owner.login" from a row. A leading "data." (the legacy row name) is ignored. */
export function getPath(row: unknown, path: string): unknown {
  return path
    .replace(/^data\./, '')
    .split('.')
    .reduce<unknown>((value, key) => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined), row)
}

export function toText(value: unknown): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' })

/** The content of one table cell: the row's `field`, passed through the column's filter. Unknown filters show the raw value. */
export function cellContent(row: unknown, field: string, filter?: string): CellContent {
  const value = getPath(row, field)
  const spec = parseFilter(filter)
  switch (spec?.name) {
    case 'uppercase':
      return { text: toText(value).toUpperCase() }
    case 'lowercase':
      return { text: toText(value).toLowerCase() }
    case 'date': {
      const time = typeof value === 'string' || typeof value === 'number' ? new Date(value).getTime() : Number.NaN
      return { text: Number.isNaN(time) ? toText(value) : dateFormat.format(time) }
    }
    case 'dataLink': {
      const href = safeHref(toText(spec.argument ? getPath(row, spec.argument) : value))
      return href ? { text: toText(value), href } : { text: toText(value) }
    }
    default:
      return { text: toText(value) }
  }
}
