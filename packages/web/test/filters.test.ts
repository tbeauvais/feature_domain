import { describe, expect, it } from 'vitest'
import { BADGE_TINTS, badgeTints, cellContent, getPath, parseFilter } from '../src/renderer/filters'

describe('parseFilter', () => {
  it('reads a name and an optional argument', () => {
    expect(parseFilter('uppercase')).toEqual({ name: 'uppercase' })
    expect(parseFilter('dataLink :data.html_url')).toEqual({ name: 'dataLink', argument: 'data.html_url' })
    expect(parseFilter(' date ')).toEqual({ name: 'date' })
    expect(parseFilter('')).toBeUndefined()
    expect(parseFilter(undefined)).toBeUndefined()
    expect(parseFilter('1bad')).toBeUndefined()
  })
})

describe('getPath', () => {
  it('reads dotted paths and ignores the legacy "data." prefix', () => {
    const row = { owner: { login: 'tb' }, name: 'repo' }
    expect(getPath(row, 'owner.login')).toBe('tb')
    expect(getPath(row, 'data.name')).toBe('repo')
    expect(getPath(row, 'missing.deep')).toBeUndefined()
  })

  it("reads only the row's own keys, never built-in properties", () => {
    for (const field of ['constructor', 'toString', '__proto__', 'name.length.constructor']) expect(getPath({ name: 'repo' }, field)).toBeUndefined()
    expect(getPath({ list: ['a', 'b'] }, 'list.1')).toBe('b')
  })
})

describe('cellContent', () => {
  const row = { name: 'Repo', html_url: 'https://github.com/x/repo', bad: 'javascript:alert(1)', updated_at: '2015-03-07T10:00:00Z', n: 3, nil: null, obj: { a: 1 } }

  it('shows raw values, with null as empty and objects as JSON', () => {
    expect(cellContent(row, 'n')).toEqual({ text: '3' })
    expect(cellContent(row, 'nil')).toEqual({ text: '' })
    expect(cellContent(row, 'obj')).toEqual({ text: '{"a":1}' })
  })

  it('applies case filters', () => {
    expect(cellContent(row, 'name', 'uppercase')).toEqual({ text: 'REPO' })
    expect(cellContent(row, 'name', 'lowercase')).toEqual({ text: 'repo' })
  })

  it('formats dates the same way everywhere (UTC)', () => {
    expect(cellContent(row, 'updated_at', 'date')).toEqual({ text: 'Mar 7, 2015' })
    expect(cellContent(row, 'name', 'date')).toEqual({ text: 'Repo' })
  })

  it('links with dataLink, but only to http(s) URLs', () => {
    expect(cellContent(row, 'name', 'dataLink :data.html_url')).toEqual({ text: 'Repo', href: 'https://github.com/x/repo' })
    expect(cellContent(row, 'html_url', 'dataLink')).toEqual({ text: 'https://github.com/x/repo', href: 'https://github.com/x/repo' })
    expect(cellContent(row, 'name', 'dataLink :data.bad')).toEqual({ text: 'Repo' })
  })

  it('shows the raw value for unknown filters', () => {
    expect(cellContent(row, 'name', 'currency')).toEqual({ text: 'Repo' })
  })

  it('formats numbers with grouped digits, leaving anything else as it is', () => {
    expect(cellContent({ n: 1204.5 }, 'n', 'number')).toEqual({ text: '1,204.5' })
    expect(cellContent({ n: '98765' }, 'n', 'number')).toEqual({ text: '98,765' })
    expect(cellContent({ n: 'n/a' }, 'n', 'number')).toEqual({ text: 'n/a' })
    expect(cellContent({ n: '' }, 'n', 'number')).toEqual({ text: '' })
  })

  it('never rounds or reinterprets a number, unless asked for fixed places', () => {
    const number = (n: unknown, filter = 'number') => cellContent({ n }, 'n', filter).text
    expect(number(0.001)).toBe('0.001')
    expect(number(1.005)).toBe('1.005')
    expect(number(-1234.25)).toBe('-1,234.25')
    // Text keeps every digit: long ids and amounts are not squeezed through a float.
    expect(number('12345678901234567890')).toBe('12,345,678,901,234,567,890')
    expect(number(' 0.000001 ')).toBe('0.000001')
    // Only plain decimals count as numbers.
    for (const text of ['0x10', '1e3', 'Infinity', '1,000', '12abc']) expect(number(text)).toBe(text)
    expect(number(Number.NaN)).toBe('NaN')
    expect(number(1.005, 'number :2')).toBe('1.01')
    expect(number(3, 'number :2')).toBe('3.00')
    expect(number('2.5', 'number :0')).toBe('3')
    expect(number(1.5, 'number :x')).toBe('1.5')
  })

  it('marks badge cells, but not empty ones', () => {
    expect(cellContent({ l: 'Ruby' }, 'l', 'badge')).toEqual({ text: 'Ruby', badge: true })
    expect(cellContent({ l: null }, 'l', 'badge')).toEqual({ text: '' })
  })

  it('tints badge values in order of first appearance, so the first four differ and a value keeps its tint', () => {
    const tints = badgeTints(['Ruby', 'Java', ' ruby ', '', 'Shell', 'Go', 'Vue', 'JAVA'])
    expect([...tints]).toEqual([
      ['ruby', 0],
      ['java', 1],
      ['shell', 2],
      ['go', 3],
      ['vue', 0],
    ])
    expect(Math.max(...tints.values())).toBeLessThan(BADGE_TINTS)
  })
})
