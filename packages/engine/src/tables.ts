// A Database table's fields, as its Fields input writes them, and the rows they allow. The Form checks rows with
// `validateRow` before sending them, and the Worker checks every row it stores, so both say the same thing.

/** What a field holds. Long text is text shown as a text area; a choice is one of the field's options. */
export const FIELD_TYPES = ['text', 'long-text', 'number', 'date', 'choice', 'yes-no'] as const
export type FieldType = (typeof FIELD_TYPES)[number]

/** How each type is written in the Fields input ("long text", "yes/no"). */
const TYPE_WORDS: Record<FieldType, string> = { text: 'text', 'long-text': 'long text', number: 'number', date: 'date', choice: 'choice', 'yes-no': 'yes/no' }

export type FieldValue = string | number | boolean

export interface TableField {
  name: string
  type: FieldType
  required: boolean
  /** A choice's options, in order. */
  options?: string[]
  /** The value a new row gets when it doesn't give one. */
  default?: FieldValue
}

/** Fields every row has, set by the server: never a field of the table, and ignored in what is sent. */
export const ROW_SYSTEM_FIELDS = ['id', 'created_at', 'updated_at'] as const

/** At most this many fields: a table wider than that wants splitting anyway. */
export const MAX_TABLE_FIELDS = 30
/** The longest text a text field takes, and a long text field. */
export const MAX_TEXT_LENGTH = 1_000
export const MAX_LONG_TEXT_LENGTH = 10_000

/**
 * A field name: a letter or "_" then letters, digits or "_". Names are keys of stored rows and `{{…}}` paths, so they
 * stay plain (and "__proto__" is refused, as it can't be read back as a key).
 */
export function isFieldName(name: string): boolean {
  return /^[A-Za-z_]\w{0,63}$/.test(name) && name !== '__proto__' && !(ROW_SYSTEM_FIELDS as readonly string[]).includes(name)
}

/**
 * Reads one line of the Fields input: `name: type, required, default value`, the type and the rest optional (text when
 * left out). A choice lists its options after the word: `status: choice open | in progress | done, default open`.
 * An option or default holding a comma, "|" or a quote is written in double quotes (`default "Paris, France"`), as
 * `formatField` writes it. Returns the field, or what is wrong with the line in words.
 */
export function parseField(line: string): { field: TableField } | { problem: string } {
  const text = line.trim()
  const colon = text.indexOf(':')
  const name = (colon < 0 ? text : text.slice(0, colon)).trim()
  if (!isFieldName(name)) {
    if ((ROW_SYSTEM_FIELDS as readonly string[]).includes(name)) return { problem: `"${name}" is set for every row already; name the field something else` }
    return { problem: `"${name}" can't be a field name: use letters, digits and "_", starting with a letter` }
  }
  const [typePart = '', ...flags] = splitOutsideQuotes(colon < 0 ? '' : text.slice(colon + 1), ',').map((s) => s.trim())
  const typed = readType(typePart)
  if ('problem' in typed) return { problem: `${name}: ${typed.problem}` }
  const field: TableField = { name, type: typed.type, required: false }
  if (typed.options) field.options = typed.options
  for (const flag of flags) {
    if (flag === '') continue
    if (/^required$/i.test(flag)) {
      field.required = true
      continue
    }
    const preset = /^default\s+(.+)$/i.exec(flag)
    if (!preset) return { problem: `${name}: "${flag}" isn't "required" or "default …"` }
    const written = unquote(preset[1]!)
    if (written === undefined) return { problem: `${name}: the default has a quote that isn't closed` }
    const value = readValue(field, written)
    if ('problem' in value) return { problem: `${name}: the default ${value.problem}` }
    field.default = value.value
  }
  return { field }
}

function readType(text: string): { type: FieldType; options?: string[] } | { problem: string } {
  const words = text.replace(/\s+/g, ' ').trim()
  if (words === '') return { type: 'text' }
  const choice = /^\s*choice\b(.*)$/is.exec(text)
  if (choice) {
    const written = splitOutsideQuotes(choice[1]!, '|')
      .filter((o) => o.trim() !== '')
      .map(unquote)
    if (written.includes(undefined)) return { problem: "an option has a quote that isn't closed" }
    const options = [...new Set(written as string[])].filter((o) => o !== '')
    if (options.length === 0) return { problem: 'a choice lists its options, like "choice low | normal | high"' }
    return { type: 'choice', options }
  }
  const type = (Object.keys(TYPE_WORDS) as FieldType[]).find((t) => TYPE_WORDS[t] === words.toLowerCase() || t === words.toLowerCase())
  if (!type) return { problem: `"${words}" isn't a type (text, long text, number, date, choice or yes/no)` }
  return { type }
}

/** One field as a line of the Fields input; `parseField` reads it back as the same field. */
export function formatField(field: TableField): string {
  const type = field.type === 'choice' ? `choice ${(field.options ?? []).map(quote).join(' | ')}` : TYPE_WORDS[field.type]
  const parts = [`${field.name}: ${type}`]
  if (field.required) parts.push('required')
  if (field.default !== undefined) parts.push(`default ${field.type === 'yes-no' ? (field.default ? 'yes' : 'no') : quote(String(field.default))}`)
  return parts.join(', ')
}

/** Splits text on `separator` where it isn't inside double quotes (JSON strings, so `\"` doesn't end one). */
function splitOutsideQuotes(text: string, separator: string): string[] {
  const parts: string[] = []
  let start = 0
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '\\') i++
      else if (c === '"') quoted = false
    } else if (c === '"') quoted = true
    else if (c === separator) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/** A value as written: double-quoted text read as a JSON string, anything else trimmed; undefined for a broken quote. */
function unquote(written: string): string | undefined {
  const text = written.trim()
  if (!text.startsWith('"')) return text
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

/** A value as `unquote` reads it back: in double quotes when it holds a separator or a quote, or starts or ends with space. */
function quote(value: string): string {
  return /[,|"]|^\s|\s$|^$/.test(value) ? JSON.stringify(value) : value
}

export interface TableSchema {
  fields: TableField[]
}

/**
 * The table's fields from its Fields input, one per non-empty line. Lines that can't be read, repeated names and fields
 * past `MAX_TABLE_FIELDS` are left out, each with a problem in words.
 */
export function tableSchema(lines: readonly string[]): { schema: TableSchema; problems: string[] } {
  const fields: TableField[] = []
  const problems: string[] = []
  for (const line of lines) {
    if (line.trim() === '') continue
    const read = parseField(line)
    if ('problem' in read) problems.push(read.problem)
    else if (fields.some((f) => f.name === read.field.name)) problems.push(`"${read.field.name}" is listed twice; the first is used`)
    else fields.push(read.field)
  }
  if (fields.length > MAX_TABLE_FIELDS) problems.push(`Only the first ${MAX_TABLE_FIELDS} of ${fields.length} fields are used`)
  return { schema: { fields: fields.slice(0, MAX_TABLE_FIELDS) }, problems }
}

/** A value as the field stores it: typed text is accepted for numbers, dates and yes/no, as forms send it. */
function readValue(field: TableField, value: unknown): { value: FieldValue } | { problem: string } {
  switch (field.type) {
    case 'text':
    case 'long-text': {
      // A number or yes/no given for text (sample rows often hold numbers, e.g. a zip code) is kept as its text.
      const text = typeof value === 'number' || typeof value === 'boolean' ? String(value) : value
      if (typeof text !== 'string') return { problem: 'must be text' }
      const max = field.type === 'text' ? MAX_TEXT_LENGTH : MAX_LONG_TEXT_LENGTH
      if (text.length > max) return { problem: `is longer than ${max.toLocaleString('en-US')} characters` }
      return { value: text }
    }
    case 'number': {
      const n = typeof value === 'number' ? value : typeof value === 'string' && NUMBER_TEXT.test(value.trim()) ? Number(value.trim()) : Number.NaN
      if (!Number.isFinite(n)) return { problem: 'must be a number' }
      // Past 2^53 a whole number can't be kept exactly: refuse it rather than store other digits.
      if (Number.isInteger(n) && !Number.isSafeInteger(n)) return { problem: 'is too large to keep exactly' }
      return { value: n }
    }
    case 'date':
      return typeof value === 'string' && isDate(value.trim()) ? { value: value.trim() } : { problem: 'must be a date like 2026-10-24' }
    case 'choice': {
      const text = typeof value === 'string' ? value.trim() : typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined
      return text !== undefined && field.options?.includes(text) ? { value: text } : { problem: `must be one of ${(field.options ?? []).join(', ')}` }
    }
    case 'yes-no': {
      if (typeof value === 'boolean') return { value }
      if (value === 1 || value === 0) return { value: value === 1 }
      const word = typeof value === 'string' ? value.trim().toLowerCase() : ''
      if (word === 'yes' || word === 'true') return { value: true }
      if (word === 'no' || word === 'false') return { value: false }
      return { problem: 'must be yes or no' }
    }
  }
}

/** A number as text: a decimal, signed or not, with an optional exponent ("12", "-1.5", ".5", "5.", "1e3"), as number inputs give. */
const NUMBER_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i

/** A calendar date written YYYY-MM-DD. */
function isDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  // setUTCFullYear, because Date.UTC reads years 0 to 99 as 1900 to 1999.
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** Nothing given: absent, null, or text with nothing in it. */
const isEmpty = (value: unknown) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '')

export interface RowProblem {
  /** The field the problem is with; absent for the row as a whole. */
  field?: string
  message: string
}

export type RowCheck = { ok: true; row: Record<string, FieldValue> } | { ok: false; problems: RowProblem[] }

/**
 * Checks values for a row against the table's fields and returns them as stored: typed, with keys the table doesn't
 * have (the server's own `id`, `created_at` and `updated_at` among them) left out.
 *
 * A new row (the default) gets each missing field's default, and must give every required field. A change (`partial`)
 * checks only the fields it gives, never the rest of the stored row, since the fields may have changed after it was
 * stored; emptying a required field is a problem, emptying another removes its value (it is left out of the result,
 * and listed in `cleared`).
 */
export function validateRow(schema: TableSchema, values: unknown, options: { partial?: boolean } = {}): RowCheck & { cleared?: string[] } {
  if (typeof values !== 'object' || values === null || Array.isArray(values))
    return { ok: false, problems: [{ message: 'A row must be an object of field values' }] }
  const given = values as Record<string, unknown>
  const row: Record<string, FieldValue> = {}
  const cleared: string[] = []
  const problems: RowProblem[] = []
  for (const field of schema.fields) {
    const present = Object.hasOwn(given, field.name)
    if (options.partial && !present) continue
    const value = present ? given[field.name] : undefined
    if (isEmpty(value)) {
      if (!options.partial && field.default !== undefined) row[field.name] = field.default
      else if (field.required) problems.push({ field: field.name, message: `${field.name} is required` })
      else if (options.partial) cleared.push(field.name)
      continue
    }
    const read = readValue(field, value)
    if ('problem' in read) problems.push({ field: field.name, message: `${field.name} ${read.problem}` })
    else row[field.name] = read.value
  }
  if (problems.length > 0) return { ok: false, problems }
  return options.partial ? { ok: true, row, cleared } : { ok: true, row }
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * A ULID: 10 characters of time (milliseconds) then 16 of randomness, in Crockford base 32, so ids sort by when they
 * were made and can't be guessed. `random` gives the 80 random bits as 10 bytes (the caller's source: the engine uses
 * no platform globals).
 */
export function ulid(time: number, random: Uint8Array): string {
  let out = ''
  let t = Math.max(0, Math.min(Math.floor(time), 2 ** 48 - 1))
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[t % 32]! + out
    t = Math.floor(t / 32)
  }
  // 80 bits as 16 characters of 5 bits.
  let bits = 0
  let width = 0
  for (let i = 0; i < 10; i++) {
    bits = (bits << 8) | (random[i] ?? 0)
    width += 8
    while (width >= 5) {
      width -= 5
      out += CROCKFORD[(bits >> width) & 31]
    }
    bits &= (1 << width) - 1
  }
  return out
}

/** Whether `id` is a ULID (`ulid`'s form, upper case). */
export function isRowId(id: string): boolean {
  return /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(id)
}

/**
 * The id of a table's `index`th sample row: a ULID at time 0 whose randomness is the index, the same every time, so
 * storing the sample rows twice (two first reads at once) stores each row once.
 */
export function sampleRowId(index: number): string {
  const bytes = new Uint8Array(10)
  for (let i = 9, n = index; i >= 0 && n > 0; i--, n = Math.floor(n / 256)) bytes[i] = n % 256
  return ulid(0, bytes)
}
