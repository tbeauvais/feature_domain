import type { AppModel } from './types.js'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const isInputValue = (value: unknown) =>
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean' ||
  (Array.isArray(value) && value.every((v) => typeof v === 'string'))

/**
 * Structural problems that would stop a value being used as a v2 model, as readable messages (empty when valid).
 * `generate` never throws for a structurally valid model, so check data from storage or the network with this first.
 */
export function validateModel(value: unknown): string[] {
  if (!isObject(value)) return ['Model is not an object']
  const problems: string[] = []
  if (value.version !== 2) problems.push(`Unsupported model version ${JSON.stringify(value.version)}`)
  if (typeof value.name !== 'string') problems.push('Model name is not a string')
  if (value.id !== undefined && typeof value.id !== 'string') problems.push('Model id is not a string')
  if (!Array.isArray(value.features)) return [...problems, 'Model has no features list']

  value.features.forEach((f: unknown, i) => {
    const at = `Feature ${i}`
    if (!isObject(f)) return problems.push(`${at} is not an object`)
    if (typeof f.feature !== 'string') problems.push(`${at} has no feature type`)
    if (typeof f.id !== 'string') problems.push(`${at} has no string id`)
    if (!isObject(f.inputs)) problems.push(`${at} has no inputs object`)
    else for (const [name, v] of Object.entries(f.inputs)) if (!isInputValue(v)) problems.push(`${at} input "${name}" is not a string, number, boolean or string list`)
    if (f.placement !== undefined && !(isObject(f.placement) && typeof f.placement.parent === 'string' && typeof f.placement.slot === 'string')) {
      problems.push(`${at} has an invalid placement`)
    }
    if (f.cache !== undefined && !isObject(f.cache)) problems.push(`${at} has an invalid cache`)
    return undefined
  })
  return problems
}

export function isAppModel(value: unknown): value is AppModel {
  return validateModel(value).length === 0
}
