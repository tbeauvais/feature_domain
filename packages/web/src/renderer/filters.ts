// Display filters for table cells. Legacy models used AngularJS filter expressions ("uppercase", "date",
// "dataLink :data.html_url"); this is a small, safe language with the same names: `name` or `name :argument`.
// Added since: "number" (grouped digits; "number :2" for fixed places), "currency" (US dollars, or "currency :EUR")
// and "badge" (a tinted chip for categories such as a language). "dataLink" also takes an address with `{path}`
// placeholders filled from the row ("dataLink :/models/{id}").

import { BADGE_COUNT } from '@feature-domain/engine'
import { safeHref } from './urls'

export interface CellContent {
  text: string
  /** Set when the cell is a link. Only http(s) addresses and paths on this site are ever returned. */
  href?: string
  /** Set for the badge filter: the cell shows a tinted chip (see `badgeTints` for its color). */
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
export const NUMERIC_FILTERS: readonly string[] = ['number', 'currency', 'date']

/** A currency formatter: US dollars, or the ISO code given (`currency :EUR`); an unknown code falls back to dollars. */
function currencyFormat(argument: string | undefined): Intl.NumberFormat {
  const code = argument !== undefined && /^[A-Za-z]{3}$/.test(argument.trim()) ? argument.trim().toUpperCase() : 'USD'
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code })
  } catch {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
  }
}

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

/**
 * Reads a dotted path such as "owner.login" from a row. A leading "data." (the legacy row name) is ignored. A key the
 * row has as a whole (e.g. "first.name" in sample rows) wins over reading it as a path.
 */
export function getPath(row: unknown, path: string): unknown {
  if (typeof row === 'object' && row !== null && !Array.isArray(row) && Object.hasOwn(row, path)) return (row as Record<string, unknown>)[path]
  return (
    path
      .replace(/^data\./, '')
      .split('.')
      // Own keys only: a field named "constructor" or "toString" is not the row's.
      .reduce<unknown>(
        (value, key) => (typeof value === 'object' && value !== null && Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined),
        row,
      )
  )
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
    case 'currency': {
      const decimal = typeof value === 'string' ? value.trim() : ''
      if (typeof value === 'number' && Number.isFinite(value)) return { text: currencyFormat(spec.argument).format(value) }
      if (DECIMAL.test(decimal)) return { text: currencyFormat(spec.argument).format(decimal as `${number}`) }
      return { text: toText(value) }
    }
    case 'badge': {
      const text = toText(value)
      return text.trim() === '' ? { text } : { text, badge: true }
    }
    case 'dataLink': {
      const argument = spec.argument
      const address = argument?.includes('{') ? fillLink(argument, row) : toText(argument ? getPath(row, argument) : value)
      const href = address === undefined ? undefined : safeHref(address)
      return href ? { text: toText(value), href } : { text: toText(value) }
    }
    default:
      return { text: toText(value) }
  }
}

/**
 * An address with its `{path}` placeholders filled from the first of `sources` that has a value there (each value
 * encoded, so it stays one part of the address). Undefined when a placeholder has no value, or one that would move the
 * address up a level ("." or "..").
 */
export function fillLink(template: string, ...sources: unknown[]): string | undefined {
  let missing = false
  const filled = template.replace(/\{([^{}]+)\}/g, (_, path: string) => {
    const text = sources.map((source) => toText(getPath(source, path.trim()))).find((t) => t !== '')
    if (text === undefined || /^\.{1,2}$/.test(text)) missing = true
    return encodeURIComponent(text ?? '')
  })
  return missing ? undefined : filled
}
