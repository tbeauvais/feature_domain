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
