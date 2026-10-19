import { describe, expect, it } from 'vitest'
import { isLinkAddress } from '../src'

describe('isLinkAddress', () => {
  it('takes http(s) addresses and paths on this site', () => {
    for (const ok of ['https://example.com', 'HTTP://x.test/a?b#c', ' /models/7 ', '/', '/models/{id}', '/a/b?c=d#e', '/caf%C3%A9'])
      expect(isLinkAddress(ok)).toBe(true)
  })

  it('refuses other schemes, relative paths and paths a browser would read as another site', () => {
    for (const bad of [
      'javascript:alert(1)',
      'mailto:x@example.com',
      'data:text/html,x',
      'models/7',
      './models',
      '//evil.example',
      '/\\evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      '/a b',
      '/a\u0000',
      '/a\\b',
      '/a\u00a0b',
      '/a\u2028b',
      '/\ufeff/evil.example',
      '/a\u0085b',
      '',
    ])
      expect(isLinkAddress(bad), JSON.stringify(bad)).toBe(false)
  })
})
