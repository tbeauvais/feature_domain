// Display filters for table cells. Legacy models used AngularJS filter expressions ("uppercase", "date",
// "dataLink :data.html_url"); this is a small, safe language with the same names: `name` or `name :argument`.
// Added since: "number" (grouped digits; "number :2" for fixed places) and "badge" (a tinted chip for categories such as a language).

import { BADGE_COUNT } from '@feature-domain/engine'
import { safeHref } from './urls'

export interface CellContent {
  text: string
  /** Set when the cell is a link. Only http(s) URLs are ever returned. */
  href?: string
  /** Set for the badge filter: the cell shows a tinted chip (see `badgeTints` for its colour). */
  badge?: true
}

/** How many tints badges cycle through: the theme's badge tints. */
export const BADGE_TINTS = BADGE_COUNT

/**
 * A tint for each badge value in a column, in order of first appearance: the first four different values always look
 * different, and a value keeps its tint in every row. (Hashing the text instead made common pairs like Ruby and Java
 * collide.) Case and surrounding spaces don't count.
 */
export function badgeTints(values: readonly string[]): Map<string, number> {
  const tints = new Map<string, number>()
  for (const value of values) {
    const key = badgeKey(value)
    if (key !== '' && !tints.has(key)) tints.set(key, tints.size % BADGE_TINTS)
  }
  return tints
}

export const badgeKey = (value: string) => value.trim().toLowerCase()

/** Filters whose cells are figures: right-aligned with tabular digits. */
export const NUMERIC_FILTERS: readonly string[] = ['number', 'date']

/**
 * The number filter's formatter: every decimal the value has, or exactly `:n` places (0-20). Text is formatted as text,
 * so long ids and amounts keep every digit.
 */
function numberFormat(argument: string | undefined): Intl.NumberFormat {
  const places = argument !== undefined && /^\d{1,2}$/.test(argument) ? Math.min(Number(argument), 20) : undefined
  return new Intl.NumberFormat('en-US', places === undefined ? { maximumFractionDigits: 20 } : { minimumFractionDigits: places, maximumFractionDigits: places })
}

/** Plain decimals only: "0x10", "1e3" and "Infinity" are text, not numbers. */
const DECIMAL = /^-?\d+(\.\d+)?$/

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
    // Own keys only: a field named "constructor" or "toString" is not the row's.
    .reduce<unknown>((value, key) => (typeof value === 'object' && value !== null && Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined), row)
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
    case 'number': {
      const decimal = typeof value === 'string' ? value.trim() : ''
      if (typeof value === 'number' && Number.isFinite(value)) return { text: numberFormat(spec.argument).format(value) }
      if (DECIMAL.test(decimal)) return { text: numberFormat(spec.argument).format(decimal as `${number}`) }
      return { text: toText(value) }
    }
    case 'badge': {
      const text = toText(value)
      return text.trim() === '' ? { text } : { text, badge: true }
    }
    case 'dataLink': {
      const href = safeHref(toText(spec.argument ? getPath(row, spec.argument) : value))
      return href ? { text: toText(value), href } : { text: toText(value) }
    }
    default:
      return { text: toText(value) }
  }
}
