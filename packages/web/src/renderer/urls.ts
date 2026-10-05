// URL policies for generated pages. Model data is untrusted, so only known-safe schemes reach the DOM.

/** An http(s) URL for links and data fetches; anything else (javascript:, data:, relative) is refused. */
export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

export function safeHref(value: string): string | undefined {
  return isHttpUrl(value) ? value.trim() : undefined
}

/** Image sources: http(s), relative URLs, and inline `data:image/` images. */
export function safeImageSrc(value: string): string | undefined {
  const src = value.trim()
  if (src === '') return undefined
  if (isHttpUrl(src) || /^data:image\//i.test(src)) return src
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(src)
  return scheme ? undefined : src
}
