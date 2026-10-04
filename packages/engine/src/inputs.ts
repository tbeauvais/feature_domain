import type { PageLocation } from './types'

export type InputType = 'string' | 'text' | 'boolean' | 'integer' | 'color' | 'page_location'

export interface InputOption {
  value: string
  text: string
}

/** Declares one parameter of a feature. `control` names the editor widget used to edit it. */
export interface InputDef {
  name: string
  label: string
  type: InputType
  control: string
  default?: string | number | boolean
  options?: InputOption[]
  min?: number
  max?: number
  placeholder?: string
}

export type Inputs = Readonly<Record<string, unknown>>

export const DEFAULT_PAGE = 'Page 1'

/**
 * Initial inputs for a new feature instance. Defaults apply only at creation: generation reads stored inputs as-is,
 * and each feature decides what an absent input means (matching how legacy models rendered).
 */
export function defaultInputs(defs: readonly InputDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const def of defs) {
    if (def.default !== undefined) out[def.name] = def.default
  }
  return out
}

export function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

export function asInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? Math.trunc(value) : parseInt(asString(value), 10)
  return Number.isFinite(n) ? n : fallback
}

/** Legacy models store booleans as `true`, `'true'`, `''` or `false`. */
export function asBool(value: unknown): boolean {
  return value === true || value === 'true'
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function pageLocation(inputs: Inputs): PageLocation | undefined {
  const loc = inputs.page_location
  if (typeof loc !== 'object' || loc === null) return undefined
  const { name, target } = loc as Record<string, unknown>
  if (typeof target !== 'string' || target.trim() === '') return undefined
  return { name: typeof name === 'string' && name !== '' ? name : DEFAULT_PAGE, target }
}

// Inputs shared by most features.

export const nameInput = (defaultName = 'untitled'): InputDef => ({
  name: 'name',
  label: 'Name',
  type: 'string',
  default: defaultName,
  control: 'text-input',
})

export const disableInput: InputDef = {
  name: 'disable',
  label: 'Disable',
  type: 'boolean',
  default: false,
  control: 'checkbox-input',
}

export const pageLocationInput: InputDef = {
  name: 'page_location',
  label: 'Page Location',
  type: 'page_location',
  control: 'page-target-selector',
}

export const alignInput = (defaultAlign: 'left' | 'center' | 'right'): InputDef => ({
  name: 'align',
  label: 'Align',
  type: 'string',
  default: defaultAlign,
  control: 'text-select',
  options: [
    { value: 'left', text: 'Left' },
    { value: 'center', text: 'Center' },
    { value: 'right', text: 'Right' },
  ],
})
