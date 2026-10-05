import type { FeatureDefinition } from '../feature.js'
import { asString, nameInput } from '../inputs.js'

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const

/** A schema in the JSON-Schema-like shape Swagger 1.x documents use. */
export interface DataSchema {
  properties?: Record<string, { type?: string; description?: string; items?: { $ref?: string } }>
}

export interface DataOperation {
  /** Display name and lookup key, e.g. "GET /users/tbeauvais/repos". */
  name: string
  method: string
  endPoint: string
  /** Name of the response schema in `schemas`, when known. */
  responseType?: string
}

/** What data-resource features export for consumers such as Table. */
export interface DataResourceExports {
  resource: string
  operations: DataOperation[]
  schemas: Record<string, DataSchema>
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

export const DataResourceFeature: FeatureDefinition = {
  type: 'DataResourceFeature',
  name: 'DataResource',
  icon: 'database',
  placement: 'none',
  inputs: [
    nameInput(),
    { name: 'resource', label: 'Resource URL', type: 'string', default: '', placeholder: 'https://', control: 'text-input' },
    {
      name: 'operation',
      label: 'Operation',
      type: 'string',
      default: 'GET',
      control: 'text-select',
      options: HTTP_METHODS.map((m) => ({ value: m, text: m[0] + m.slice(1).toLowerCase() })),
    },
  ],

  generate(inputs) {
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
