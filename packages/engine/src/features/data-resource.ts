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

/**
 * Path part of an absolute URL for operation names (like `new URL(url).pathname`, without depending on platform
 * globals); the part before any query or fragment when it isn't an absolute URL.
 */
export function pathname(url: string): string {
  const absolute = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*([^?#]*)/i.exec(url)
  if (absolute) return absolute[1] || '/'
  return url.split(/[?#]/)[0]!
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
    const method = (HTTP_METHODS as readonly string[]).includes(asString(inputs.operation)) ? asString(inputs.operation) : 'GET'
    const exports: DataResourceExports = {
      resource: asString(inputs.name),
      operations: [{ name: `${method} ${pathname(resource)}`, method, endPoint: resource }],
      schemas: {},
    }
    return { exports: { ...exports } }
  },
}
