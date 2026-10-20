// URL policies for generated pages. Model data is untrusted, so only known-safe schemes reach the DOM.

import { isLinkAddress } from '@feature-domain/engine'
import type { InjectionKey } from 'vue'

/** An http(s) URL for links and data fetches; anything else (javascript:, data:, relative) is refused. */
export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

/** A link's address: http(s), or a path on this site ("/models/7"; see the engine's `isLinkAddress`). */
export function safeHref(value: string): string | undefined {
  return isLinkAddress(value) ? value.trim() : undefined
}

/** Links to other sites open in a new tab; paths on this site open in the same one. */
export const opensNewTab = (href: string): boolean => isHttpUrl(href)

/** Image sources: http(s), relative URLs, and inline `data:image/` images. */
export function safeImageSrc(value: string): string | undefined {
  const src = value.trim()
  if (src === '') return undefined
  if (isHttpUrl(src) || /^data:image\//i.test(src)) return src
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(src)
  return scheme ? undefined : src
}

/** How a page opens an address (a Form's Then open, in this tab); tests provide a fake. */
export const OPEN_ADDRESS: InjectionKey<(href: string) => void> = Symbol('openAddress')

export const browserOpenAddress = (href: string): void => window.location.assign(href)
