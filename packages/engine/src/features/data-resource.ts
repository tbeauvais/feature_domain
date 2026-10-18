import type { FeatureDefinition } from '../feature.js'
import { asOneOf, asString, nameInput } from '../inputs.js'

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const

/** A schema in the JSON-Schema-like shape API specs use (references are by schema name). */
export interface DataSchema {
  type?: string
  /** For an array schema: the item schema's name. */
  items?: { $ref?: string }
  properties?: Record<string, { type?: string; description?: string; items?: { $ref?: string } }>
  /** Properties that must be given (e.g. in a request body). */
  required?: string[]
}

/** An operation's input, as a Form shows it: from the spec's parameters or its request body's properties. */
export interface DataParameter {
  name: string
  in: 'path' | 'query' | 'header' | 'body' | 'form'
  type: string
  description: string
  required: boolean
}

export interface DataOperation {
  /** Display name and lookup key, e.g. "GET /users/tbeauvais/repos". */
  name: string
  method: string
  endPoint: string
  /** Name of the response schema in `schemas`, when known. */
  responseType?: string
  /** What the spec says the operation does. */
  summary?: string
  /** The operation's inputs, when a spec describes them. */
  parameters?: DataParameter[]
  /** How a request body is sent: as a form (form-encoded or multipart) when the spec says so, else JSON. */
  requestType?: 'form' | 'multipart'
  /** Served in the browser from the resource's sample rows (GET lists them, POST adds one, DELETE removes one a form added) instead of an address. */
  sample?: true
}

/** What data-resource features export for consumers such as Table. */
export interface DataResourceExports {
  resource: string
  operations: DataOperation[]
  schemas: Record<string, DataSchema>
  /** The sample rows, when the resource serves sample data. */
  sampleRows?: Record<string, unknown>[]
}

/** The feature types whose exports are `DataResourceExports`. */
export const DATA_RESOURCE_TYPES = ['DataResourceFeature', 'SwaggerDataResourceFeature']

export function isDataResourceExports(value: unknown): value is DataResourceExports {
  const v = value as Partial<DataResourceExports> | undefined
  return typeof v === 'object' && v !== null && typeof v.resource === 'string' && Array.isArray(v.operations) && typeof v.schemas === 'object'
}

const DOUBLE_DOT = ['..', '.%2e', '%2e.', '%2e%2e']
const SINGLE_DOT = ['.', '%2e']

/** Percent-encodes what the WHATWG URL parser encodes in a path segment (lone surrogates become U+FFFD). */
function encodeSegment(segment: string): string {
  // Control characters are exactly what this encodes.
  // eslint-disable-next-line no-control-regex
  return segment.replace(/[\u0000-\u0020"#<>?`{}^\u007f]|[^\u0000-\u007f]/gu, (c) => {
    try {
      return encodeURIComponent(c)
    } catch {
      return '%EF%BF%BD'
    }
  })
}

/**
 * Path part of a URL, computed like `new URL(url).pathname` (which the legacy app used to name operations) without
 * depending on platform globals: tabs and newlines are removed, backslashes act as slashes, dot segments are
 * resolved and unsafe characters are percent-encoded. For a string that isn't an absolute URL, the part before any
 * query or fragment.
 */
export function pathname(url: string): string {
  const cleaned = url.replace(/[\t\n\r]/g, '').trim()
  const absolute = /^[a-z][a-z\d+.-]*:[/\\]{2}[^/\\?#]*([^?#]*)/i.exec(cleaned)
  if (!absolute) return cleaned.split(/[?#]/)[0]!
  const segments = absolute[1]!.replace(/\\/g, '/').split('/').slice(1)
  const out: string[] = []
  segments.forEach((segment, i) => {
    const last = i === segments.length - 1
    const lower = segment.toLowerCase()
    if (DOUBLE_DOT.includes(lower)) {
      out.pop()
      if (last) out.push('')
    } else if (SINGLE_DOT.includes(lower)) {
      if (last) out.push('')
    } else {
      out.push(segment)
    }
  })
  return `/${out.map(encodeSegment).join('/')}`
}

/** The name a data resource gives its operation, e.g. "GET /users/me/repos" (matches legacy operation names). */
export function operationName(method: string, url: string): string {
  return `${method} ${pathname(url)}`
}

/** An HTTP method, uppercased; GET when it isn't one of HTTP_METHODS. */
export function httpMethod(value: string): (typeof HTTP_METHODS)[number] {
  const method = value.toUpperCase()
  return (HTTP_METHODS as readonly string[]).includes(method) ? (method as (typeof HTTP_METHODS)[number]) : 'GET'
}

/** At most this many sample rows are kept: sample data is for trying a page out, not a database. */
export const MAX_SAMPLE_ROWS = 500

/** What a new data resource starts with, so a Table or Chart on it shows something at once (text and a number). */
const EXAMPLE_ROWS = [
  { name: 'Ada Lovelace', role: 'Engineer', city: 'London', projects: 12 },
  { name: 'Grace Hopper', role: 'Admiral', city: 'New York', projects: 9 },
  { name: 'Alan Turing', role: 'Researcher', city: 'Manchester', projects: 7 },
]

/** Sample rows from their JSON text: a list of objects. Anything else is a problem, in words. */
export function parseSampleRows(text: string): { rows: Record<string, unknown>[]; problem?: string } {
  const parsed = parseRows(text)
  if (parsed.problem) return parsed
  // A "__proto__" key can't be read back as a field, so it is left out.
  let dropped = false
  const rows = parsed.rows.map((row) => {
    if (!Object.hasOwn(row, '__proto__')) return row
    dropped = true
    return Object.fromEntries(Object.entries(row).filter(([key]) => key !== '__proto__'))
  })
  if (dropped) return { rows, problem: 'The "__proto__" key in sample rows was left out' }
  // JSON numbers past 2^53 lose digits when read: say so, so they can be quoted as text instead.
  const inexact = rows.flatMap((row) => Object.entries(row)).find(([, v]) => typeof v === 'number' && Number.isInteger(v) && !Number.isSafeInteger(v))
  if (inexact) return { rows, problem: `"${inexact[0]}" has a number too long to keep exactly; put it in quotes to keep every digit` }
  return { rows }
}

function parseRows(text: string): { rows: Record<string, unknown>[]; problem?: string } {
  if (text.trim() === '') return { rows: [] }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    return { rows: [], problem: `Sample rows are not valid JSON (${error instanceof Error ? error.message : String(error)})` }
  }
  if (!Array.isArray(value)) return { rows: [], problem: 'Sample rows must be a list, like [{"name": "Ada"}]' }
  const rows = value.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null && !Array.isArray(row))
  if (rows.length < value.length) return { rows, problem: `${value.length - rows.length} sample row(s) are not objects and were left out` }
  return { rows }
}

/** The operations of a resource serving sample data. */
export const SAMPLE_OPERATIONS: readonly DataOperation[] = [
  { name: 'GET rows', method: 'GET', endPoint: '', sample: true },
  { name: 'POST rows', method: 'POST', endPoint: '', sample: true },
  // Removes a row a form added (the model's own rows stay: they are the sample).
  { name: 'DELETE rows', method: 'DELETE', endPoint: '', sample: true },
]

export const DataResourceFeature: FeatureDefinition = {
  type: 'DataResourceFeature',
  name: 'DataResource',
  icon: 'database',
  placement: 'none',
  inputs: [
    nameInput(),
    {
      name: 'source',
      label: 'Source',
      type: 'string',
      // Stored resources without a Source fetch their address, as before; new ones start with sample rows.
      default: 'address',
      initial: 'sample',
      control: 'segmented',
      options: [
        { value: 'address', text: 'Address' },
        { value: 'sample', text: 'Sample data' },
      ],
    },
    { name: 'resource', label: 'Resource URL', type: 'string', default: '', placeholder: 'https://', control: 'text-input', showWhen: { input: 'source', notEquals: 'sample' } },
    {
      name: 'operation',
      label: 'Operation',
      type: 'string',
      default: 'GET',
      control: 'text-select',
      options: HTTP_METHODS.map((m) => ({ value: m, text: m[0] + m.slice(1).toLowerCase() })),
      showWhen: { input: 'source', notEquals: 'sample' },
    },
    {
      name: 'sample_rows',
      label: 'Sample rows (JSON)',
      type: 'text',
      default: '[]',
      initial: JSON.stringify(EXAMPLE_ROWS, null, 2),
      control: 'json-area',
      showWhen: { input: 'source', equals: 'sample' },
    },
  ],

  generate(inputs, ctx) {
    if (asOneOf(inputs.source, ['address', 'sample'], 'address') === 'sample') {
      const parsed = parseSampleRows(asString(inputs.sample_rows))
      if (parsed.problem) ctx.report('warning', parsed.problem)
      if (parsed.rows.length > MAX_SAMPLE_ROWS) ctx.report('warning', `Only the first ${MAX_SAMPLE_ROWS} of ${parsed.rows.length} sample rows are used`)
      const exports: DataResourceExports = {
        resource: asString(inputs.name),
        operations: SAMPLE_OPERATIONS.map((o) => ({ ...o })),
        schemas: {},
        sampleRows: parsed.rows.slice(0, MAX_SAMPLE_ROWS),
      }
      return { exports: { ...exports } }
    }
    const resource = asString(inputs.resource)
    const method = httpMethod(asString(inputs.operation))
    const exports: DataResourceExports = {
      resource: asString(inputs.name),
      operations: [{ name: operationName(method, resource), method, endPoint: resource }],
      schemas: {},
    }
    return { exports: { ...exports } }
  },
}
