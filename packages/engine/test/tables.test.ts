import { describe, expect, it } from 'vitest'
import {
  formatField,
  isFieldName,
  isRowId,
  MAX_LONG_TEXT_LENGTH,
  MAX_TABLE_FIELDS,
  MAX_TEXT_LENGTH,
  parseField,
  sampleRowId,
  tableSchema,
  ulid,
  validateRow,
  type TableField,
  type TableSchema,
} from '../src'

const field = (line: string) => {
  const read = parseField(line)
  if ('problem' in read) throw new Error(read.problem)
  return read.field
}
const problem = (line: string) => {
  const read = parseField(line)
  return 'problem' in read ? read.problem : undefined
}

describe('parseField', () => {
  it('reads a name, a type and flags', () => {
    expect(field('title: text, required')).toEqual({ name: 'title', type: 'text', required: true })
    expect(field('details: long text')).toEqual({ name: 'details', type: 'long-text', required: false })
    expect(field('count: number, default 3')).toEqual({ name: 'count', type: 'number', required: false, default: 3 })
    expect(field('due: date')).toEqual({ name: 'due', type: 'date', required: false })
    expect(field('urgent: yes/no, default no')).toEqual({ name: 'urgent', type: 'yes-no', required: false, default: false })
  })

  it('takes text when no type is given, and spacing and case loosely', () => {
    expect(field('  name ')).toEqual({ name: 'name', type: 'text', required: false })
    expect(field('name:')).toEqual({ name: 'name', type: 'text', required: false })
    expect(field('notes :  Long   Text ,  REQUIRED')).toEqual({ name: 'notes', type: 'long-text', required: true })
    expect(field('done: yes-no')).toMatchObject({ type: 'yes-no' })
  })

  it('reads a choice and its options, without repeats', () => {
    expect(field('status: choice open | in progress | done | open, required, default open')).toEqual({
      name: 'status',
      type: 'choice',
      required: true,
      options: ['open', 'in progress', 'done'],
      default: 'open',
    })
  })

  it('says what is wrong with a line', () => {
    expect(problem('2nd: text')).toMatch(/can't be a field name/)
    expect(problem('first name: text')).toMatch(/can't be a field name/)
    expect(problem('__proto__: text')).toMatch(/can't be a field name/)
    expect(problem('id: text')).toMatch(/set for every row already/)
    expect(problem('created_at: date')).toMatch(/set for every row already/)
    expect(problem('size: huge')).toMatch(/"huge" isn't a type/)
    expect(problem('status: choice')).toMatch(/lists its options/)
    expect(problem('status: choice a | b, default c')).toMatch(/the default must be one of a, b/)
    expect(problem('count: number, default many')).toMatch(/the default must be a number/)
    expect(problem('title: text, unique')).toMatch(/"unique" isn't "required" or "default …"/)
  })

  it('writes fields back as lines that read the same', () => {
    const lines = [
      'title: text, required',
      'details: long text',
      'count: number, default 2.5',
      'due: date',
      'urgent: yes/no, default yes',
      'status: choice open | done, required, default open',
    ]
    for (const line of lines) expect(formatField(field(line))).toBe(line)
    const all: TableField[] = lines.map(field)
    expect(all.map(formatField).map(field)).toEqual(all)
  })

  it('reads options and defaults in double quotes, and writes them so when they hold a comma, "|" or a quote', () => {
    expect(field('city: text, default "Paris, France"')).toEqual({ name: 'city', type: 'text', required: false, default: 'Paris, France' })
    expect(field('size: choice "S, M" | "a|b" | plain | "say \\"hi\\"", required')).toEqual({
      name: 'size',
      type: 'choice',
      required: true,
      options: ['S, M', 'a|b', 'plain', 'say "hi"'],
    })
    const tricky: TableField[] = [
      { name: 'city', type: 'text', required: false, default: 'Paris, France' },
      { name: 'size', type: 'choice', required: true, options: ['S, M', 'a|b', ' padded ', 'say "hi"'], default: 'a|b' },
      { name: 'note', type: 'text', required: false, default: 'required' },
    ]
    for (const f of tricky) expect(field(formatField(f))).toEqual(f)
    expect(formatField(tricky[0]!)).toBe('city: text, default "Paris, France"')
    expect(problem('city: text, default "Paris')).toMatch(/quote that isn't closed/)
    expect(problem('size: choice "a | b')).toMatch(/quote that isn't closed/)
  })

  it('takes plain names only', () => {
    expect(isFieldName('due_on')).toBe(true)
    expect(isFieldName('_hidden')).toBe(true)
    expect(isFieldName('a'.repeat(65))).toBe(false)
    expect(isFieldName('updated_at')).toBe(false)
  })
})

describe('tableSchema', () => {
  it('reads every line, leaving out blank ones, unreadable ones and repeats with a problem each', () => {
    const { schema, problems } = tableSchema(['title: text, required', '', 'size: huge', 'title: number', 'done: yes/no'])
    expect(schema.fields.map((f) => f.name)).toEqual(['title', 'done'])
    expect(problems).toEqual(['size: "huge" isn\'t a type (text, long text, number, date, choice or yes/no)', '"title" is listed twice; the first is used'])
  })

  it(`uses at most ${MAX_TABLE_FIELDS} fields`, () => {
    const { schema, problems } = tableSchema(Array.from({ length: MAX_TABLE_FIELDS + 2 }, (_, i) => `f${i}`))
    expect(schema.fields).toHaveLength(MAX_TABLE_FIELDS)
    expect(problems).toEqual([`Only the first ${MAX_TABLE_FIELDS} of ${MAX_TABLE_FIELDS + 2} fields are used`])
  })
})

describe('validateRow', () => {
  const schema: TableSchema = tableSchema([
    'title: text, required',
    'details: long text',
    'count: number',
    'due: date',
    'urgent: yes/no',
    'status: choice open | done, required, default open',
  ]).schema

  it('returns a new row typed, with defaults, from what a form sends', () => {
    expect(validateRow(schema, { title: 'Fix the door', count: '12', due: ' 2026-10-24 ', urgent: 'yes' })).toEqual({
      ok: true,
      row: { title: 'Fix the door', count: 12, due: '2026-10-24', urgent: true, status: 'open' },
    })
    expect(validateRow(schema, { title: 'x', count: -1.5, urgent: false, status: 'done', details: '' })).toEqual({
      ok: true,
      row: { title: 'x', count: -1.5, urgent: false, status: 'done' },
    })
  })

  it("leaves out keys the table doesn't have, the server's own fields among them", () => {
    const values = JSON.parse(
      '{"title": "x", "id": "1", "created_at": "2020-01-01", "updated_at": "2020-01-01", "extra": 1, "__proto__": {"admin": true}}',
    ) as unknown
    const check = validateRow(schema, values)
    expect(check).toEqual({ ok: true, row: { title: 'x', status: 'open' } })
    expect(Object.getPrototypeOf(check.ok && check.row)).toBe(Object.prototype)
  })

  it('names every problem', () => {
    const check = validateRow(schema, { title: '  ', count: 'lots', due: '2026-02-30', urgent: 'maybe', status: 'closed' })
    expect(check).toEqual({
      ok: false,
      problems: [
        { field: 'title', message: 'title is required' },
        { field: 'count', message: 'count must be a number' },
        { field: 'due', message: 'due must be a date like 2026-10-24' },
        { field: 'urgent', message: 'urgent must be yes or no' },
        { field: 'status', message: 'status must be one of open, done' },
      ],
    })
    expect(validateRow(schema, { title: { text: 'x' } })).toMatchObject({ problems: [{ field: 'title', message: 'title must be text' }] })
    expect(validateRow(schema, [])).toEqual({ ok: false, problems: [{ message: 'A row must be an object of field values' }] })
    expect(validateRow(schema, null)).toMatchObject({ ok: false })
  })

  it('reads numbers as number inputs and people write them, refusing ones it would store other digits of', () => {
    for (const [given, stored] of [
      ['.5', 0.5],
      ['5.', 5],
      ['+2', 2],
      ['1e3', 1000],
      ['-1.5E-2', -0.015],
      [' 7 ', 7],
    ] as const)
      expect(validateRow(schema, { title: 'x', count: given }), given).toMatchObject({ ok: true, row: { count: stored } })
    for (const bad of ['1,000', '0x10', 'Infinity', '1e', '.', '12345678901234567890'])
      expect(validateRow(schema, { title: 'x', count: bad }).ok, bad).toBe(false)
    expect(validateRow(schema, { title: 'x', count: 2 ** 53 })).toMatchObject({ problems: [{ message: 'count is too large to keep exactly' }] })
  })

  it('keeps a number or yes/no given for text or a choice as its text, and 1 or 0 as yes or no (sample rows hold them)', () => {
    const typed = tableSchema(['zip: text', 'level: choice 1 | 2', 'done: yes/no']).schema
    expect(validateRow(typed, { zip: 12345, level: 2, done: 1 })).toEqual({ ok: true, row: { zip: '12345', level: '2', done: true } })
    expect(validateRow(typed, { zip: true, done: 0 })).toEqual({ ok: true, row: { zip: 'true', done: false } })
    expect(validateRow(typed, { level: 3, done: 2 }).ok).toBe(false)
  })

  it('reads dates in any year from 0000 to 9999', () => {
    const dated = tableSchema(['on: date']).schema
    for (const ok of ['0050-06-01', '0001-01-01', '0000-02-29', '2024-02-29', '9999-12-31']) expect(validateRow(dated, { on: ok }).ok, ok).toBe(true)
    for (const bad of ['0050-02-29', '2023-02-29', '2026-13-01', '2026-1-01', '26-01-01']) expect(validateRow(dated, { on: bad }).ok, bad).toBe(false)
  })

  it('caps text and long text', () => {
    expect(validateRow(schema, { title: 'x'.repeat(MAX_TEXT_LENGTH) }).ok).toBe(true)
    expect(validateRow(schema, { title: 'x'.repeat(MAX_TEXT_LENGTH + 1) })).toMatchObject({ problems: [{ message: 'title is longer than 1,000 characters' }] })
    expect(validateRow(schema, { title: 'x', details: 'x'.repeat(MAX_LONG_TEXT_LENGTH) }).ok).toBe(true)
    expect(validateRow(schema, { title: 'x', details: 'x'.repeat(MAX_LONG_TEXT_LENGTH + 1) }).ok).toBe(false)
  })

  it('checks only the fields a change gives, and lists the ones it empties', () => {
    expect(validateRow(schema, { status: 'done' }, { partial: true })).toEqual({ ok: true, row: { status: 'done' }, cleared: [] })
    expect(validateRow(schema, { count: '', due: null }, { partial: true })).toEqual({ ok: true, row: {}, cleared: ['count', 'due'] })
    // A required field can't be emptied, even one with a default.
    expect(validateRow(schema, { title: '', status: '' }, { partial: true })).toEqual({
      ok: false,
      problems: [
        { field: 'title', message: 'title is required' },
        { field: 'status', message: 'status is required' },
      ],
    })
  })
})

describe('ulid', () => {
  it('writes the time then the randomness in Crockford base 32', () => {
    // The time part of the ULID spec's example.
    expect(ulid(1469918176385, new Uint8Array(10))).toBe('01ARYZ6S410000000000000000')
    expect(ulid(0, new Uint8Array(10).fill(255))).toBe('0000000000ZZZZZZZZZZZZZZZZ')
    expect(ulid(2 ** 48 - 1, new Uint8Array(10))).toBe('7ZZZZZZZZZ0000000000000000')
  })

  it('sorts by time', () => {
    const random = new Uint8Array(10).fill(7)
    const ids = [5, 1_700_000_000_000, 1_700_000_000_001, 2 ** 45].map((t) => ulid(t, random))
    expect([...ids].sort()).toEqual(ids)
  })

  it('is recognized as a row id, and sample row ids are fixed and distinct', () => {
    expect(isRowId(ulid(Date.UTC(2026, 9, 24), new Uint8Array(10).fill(200)))).toBe(true)
    expect(isRowId('01arYZ6S410000000000000000')).toBe(false)
    expect(isRowId('81ARYZ6S410000000000000000')).toBe(false)
    expect(isRowId('01ARYZ6S41000000000000000I')).toBe(false)
    expect(sampleRowId(0)).toBe('00000000000000000000000000')
    expect(sampleRowId(1)).toBe('00000000000000000000000001')
    const ids = Array.from({ length: 1000 }, (_, i) => sampleRowId(i))
    expect(new Set(ids).size).toBe(1000)
    expect(ids.every(isRowId)).toBe(true)
    expect([...ids].sort()).toEqual(ids)
  })
})
