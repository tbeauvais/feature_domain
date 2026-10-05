import { TONES, type Align, type InputValue, type Tone } from './types.js'

export type InputType = 'string' | 'text' | 'boolean' | 'integer' | 'color' | 'list' | 'reference'

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
  default?: InputValue
  options?: InputOption[]
  min?: number
  max?: number
  placeholder?: string
  /** For `reference` inputs: feature types the referenced instance may have. */
  accepts?: string[]
  /** For `reference` inputs: generation fails (the feature is skipped) when no instance is referenced. */
  required?: boolean
}

export type Inputs = Readonly<Record<string, InputValue | undefined>>

/** Initial inputs for a new feature instance. */
export function defaultInputs(defs: readonly InputDef[]): Record<string, InputValue> {
  const out: Record<string, InputValue> = {}
  for (const def of defs) {
    if (def.default !== undefined) out[def.name] = def.default
  }
  return out
}

/** Stored inputs with defaults filled in for any that are absent. Never mutates `stored`. */
export function resolveInputs(defs: readonly InputDef[], stored: Inputs): Inputs {
  return { ...defaultInputs(defs), ...withoutUndefined(stored) }
}

function withoutUndefined(inputs: Inputs): Record<string, InputValue> {
  const out: Record<string, InputValue> = {}
  for (const [k, v] of Object.entries(inputs)) if (v !== undefined && v !== null) out[k] = v
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

export function asBool(value: unknown): boolean {
  return value === true
}

export function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => asString(v)) : []
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function asAlign(value: unknown, fallback: Align): Align {
  return value === 'left' || value === 'center' || value === 'right' ? value : fallback
}

export function asTone(value: unknown): Tone | undefined {
  return (TONES as readonly unknown[]).includes(value) ? (value as Tone) : undefined
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

export const alignInput = (defaultAlign: Align): InputDef => ({
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

export const toneOptions = (tones: readonly Tone[], withNone: boolean): InputOption[] => [
  ...(withNone ? [{ value: '', text: 'None' }] : []),
  ...tones.map((t) => ({ value: t, text: t[0]!.toUpperCase() + t.slice(1) })),
]
