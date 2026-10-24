import { describe, expect, it } from 'vitest'
import { isAppDataAddress, isDataAddress, isLinkAddress, isTableKey, tableRowsAddress } from '../src'

describe('isAppDataAddress', () => {
  it("takes a Database table's rows, relative to the app, and one row by placeholder or id", () => {
    for (const ok of ['tables/12/rows', 'tables/a_b-C/rows', 'tables/12/rows/{id}', 'tables/12/rows/01ARYZ6S410000000000000000', tableRowsAddress('7', '{id}')])
      expect(isAppDataAddress(ok), ok).toBe(true)
  })

  it('refuses full paths (so a page reaches only its own model), other placeholders, and anything past a row', () => {
    for (const bad of [
      '/api/v1/models/other/tables/12/rows',
      '/tables/12/rows',
      './tables/12/rows',
      'tables/../12/rows',
      'tables/12/rows/',
      'tables/12/rows/{name}',
      'tables/12/rows/abc',
      'tables/12/rows/01arYZ6S410000000000000000',
      'tables/12/rows/01ARYZ6S410000000000000000/x',
      'tables/12/rows?all=1',
      'tables/%2e%2e/rows',
      'tables/12/rows ',
      `tables/${'a'.repeat(65)}/rows`,
      'tables//rows',
    ])
      expect(isAppDataAddress(bad), bad).toBe(false)
  })

  it('is a data address, and only plain keys make one', () => {
    expect(isDataAddress('tables/12/rows')).toBe(true)
    expect(isTableKey('12')).toBe(true)
    expect(isTableKey('a/b')).toBe(false)
    expect(isTableKey('')).toBe(false)
  })
})

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
