import type { Align, InputValue } from './types.js'

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
  /**
   * What the input means when a stored instance doesn't have it (`resolveInputs` fills it in), so adding an input never
   * changes existing models. Also the value of new instances, unless `initial` says otherwise.
   */
  default?: InputValue
  /** The value for new instances when it differs from `default`, e.g. a new Image starts as an illustration. */
  initial?: InputValue
  /**
   * Show the input in the editor only while other inputs have these values (e.g. the image address for Source = Link).
   * Every condition must hold; `equals` may list several values, any of which matches, and `notEquals` matches any
   * other value (so an unrecognised stored value still shows what generation falls back to).
   */
  showWhen?: ShowCondition | readonly ShowCondition[]
  options?: InputOption[]
  min?: number
  max?: number
  placeholder?: string
  /** For `reference` inputs: feature types the referenced instance may have. */
  accepts?: string[]
  /** For `reference` inputs: generation fails (the feature is skipped) when no instance is referenced. */
  required?: boolean
  /**
   * For `reference` inputs: a soft reference. If the referenced feature is missing, of the wrong type, suppressed or
   * not generated, this feature still generates (with a warning) and `ctx.resolve` returns undefined for it, so the
   * feature falls back (e.g. a Page without its Theme uses the default theme).
   */
  soft?: boolean
}

export type ShowCondition = { input: string } & ({ equals: InputValue | readonly InputValue[] } | { notEquals: InputValue })

/** A input's `showWhen` as a list of conditions. */
export function showConditions(def: InputDef): readonly ShowCondition[] {
  if (!def.showWhen) return []
  return 'input' in def.showWhen ? [def.showWhen as ShowCondition] : (def.showWhen as readonly ShowCondition[])
}

export type Inputs = Readonly<Record<string, InputValue | undefined>>

/** The values absent inputs take (see `InputDef.default`). */
export function defaultInputs(defs: readonly InputDef[]): Record<string, InputValue> {
  const out: Record<string, InputValue> = {}
  for (const def of defs) {
    if (def.default !== undefined) out[def.name] = def.default
  }
  return out
}

/** Inputs for a new feature instance: each input's `initial` value, else its default. */
export function initialInputs(defs: readonly InputDef[]): Record<string, InputValue> {
  const out: Record<string, InputValue> = {}
  for (const def of defs) {
    const value = def.initial ?? def.default
    if (value !== undefined) out[def.name] = value
  }
  return out
}

/** Whether the editor shows `def` for these stored inputs (absent inputs read as their defaults). */
export function isInputShown(def: InputDef, defs: readonly InputDef[], stored: Inputs): boolean {
  const conditions = showConditions(def)
  if (conditions.length === 0) return true
  const values = resolveInputs(defs, stored)
  return conditions.every((condition) => {
    const value = values[condition.input]
    if ('notEquals' in condition) return value !== condition.notEquals
    const { equals } = condition
    return Array.isArray(equals) ? (equals as readonly InputValue[]).some((e) => e === value) : equals === value
  })
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

/** `value` if it is one of `options`, else `fallback`. */
export function asOneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return (options as readonly unknown[]).includes(value) ? (value as T) : fallback
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

/** Options labelled by their value, capitalised: "accent" -> "Accent". */
export const capitalisedOptions = (values: readonly string[]): InputOption[] => values.map((value) => ({ value, text: value[0]!.toUpperCase() + value.slice(1) }))
