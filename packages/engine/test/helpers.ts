import type { AppModel, FeatureInstance } from '../src'

export function inst(feature: string, id: string, inputs: Record<string, unknown> = {}, target = '#page_container'): FeatureInstance {
  return { feature, id, inputs: { name: `${feature} ${id}`, page_location: { name: 'Page 1', target }, ...inputs } }
}

export const page = (inputs: Record<string, unknown> = {}): FeatureInstance =>
  inst('PageFeature', '1', { name: 'Page', ...inputs }, '#content_section')

export const model = (...features: FeatureInstance[]): AppModel => ({ name: 'test', features })

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value)) deepFreeze(v)
  }
  return value
}
