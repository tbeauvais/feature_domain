// Where a generated page's links may go: http(s) addresses, or paths on the site serving the page.

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
 * other path on this site is allowed (not the proxy, nor any later endpoint). A segment can't be "." or "..", or hold
 * an encoded dot, which browsers would read as one and so leave the models API.
 */
export function isModelsApiAddress(value: string): boolean {
  const match = /^\/api\/v1\/models(?:\/([^/?#\\\s\p{Cc}]+))?(?:\?[^#\s\p{Cc}]*)?$/u.exec(value.trim())
  if (!match) return false
  const segment = match[1]
  return segment === undefined || !(/^\.{1,2}$/.test(segment) || /%2e/i.test(segment))
}
