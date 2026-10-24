// Where a generated page's links may go: http(s) addresses, or paths on the site serving the page.

import { isRowId } from './tables.js'

/**
 * Whether an address can be a link: http(s), or a path on this site ("/models/7"). A path is refused if it holds
 * whitespace, control characters or backslashes, or starts with "//": browsers drop tabs and newlines and read "\" as
 * "/" in addresses, so "/\evil.example" and "/<tab>/evil.example" would both open another site.
 */
export function isLinkAddress(value: string): boolean {
  const address = value.trim()
  return /^https?:\/\//i.test(address) || isSitePath(address)
}

/** A path on this site: "/" then anything but a second "/", whitespace, control characters or backslashes. */
export function isSitePath(value: string): boolean {
  return /^\/(?!\/)[^\\\s\p{Cc}]*$/u.test(value)
}

/** The one API on this site a page may read and change data through: the model list (the home page is built on it). */
export const MODELS_API_PATH = '/api/v1/models'

/**
 * Whether a data address is the models API on this site: "/api/v1/models", or one model under it
 * ("/api/v1/models/{id}"), with an optional query. Pages fetch it from the browser with the viewer's session, so no
 * other path on this site is allowed (not the proxy, nor any later endpoint); every http(s) address, including a full
 * one on this site, is fetched without cookies. A segment can't be "." or "..", or hold an encoded dot, which browsers
 * would read as one and so leave the models API.
 */
export function isModelsApiAddress(value: string): boolean {
  const match = /^\/api\/v1\/models(?:\/([^/?#\\\s\p{Cc}]+))?(?:\?[^#\s\p{Cc}]*)?$/u.exec(value.trim())
  if (!match) return false
  const segment = match[1]
  return segment === undefined || !(/^\.{1,2}$/.test(segment) || /%2e/i.test(segment))
}

/**
 * Whether a table key (a Database table's instance id) can be part of its rows' address: letters, digits, "_" and "-".
 * Instance ids are counters ("12"), so a key outside these is a model edited by hand.
 */
export function isTableKey(key: string): boolean {
  return /^[\w-]{1,64}$/.test(key)
}

/** The address of a Database table's rows, relative to the app (`tables/12/rows`), and of one row (`…/rows/{id}`). */
export function tableRowsAddress(key: string, row?: string): string {
  return row === undefined ? `tables/${key}/rows` : `tables/${key}/rows/${row}`
}

/**
 * Whether a data address is a Database table's rows, relative to the app: `tables/<key>/rows`, or one row under it,
 * named by a `{id}` placeholder (filled from a row) or a row id. Never a full path: the page's data store puts its own
 * model in front (`/api/v1/models/<id>/`), so a page can only reach the rows of the model it shows.
 */
export function isAppDataAddress(value: string): boolean {
  const [tables, key, rows, row, ...rest] = value.split('/')
  if (tables !== 'tables' || key === undefined || !isTableKey(key) || rows !== 'rows' || rest.length > 0) return false
  return row === undefined || row === '{id}' || isRowId(row)
}
