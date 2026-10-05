import { ROOT_ID, ROOT_SLOT, type AppModel, type FeatureInstance, type InputValue, type Placement } from '../src'

export const at = (parent: string, slot: string): Placement => ({ parent, slot })

/** A feature instance placed in page "1" unless `placement` says otherwise (null: unplaced). */
export function inst(feature: string, id: string, inputs: Record<string, InputValue> = {}, placement: Placement | null = at('1', 'content')): FeatureInstance {
  const instance: FeatureInstance = { feature, id, inputs: { name: `${feature} ${id}`, ...inputs } }
  if (placement) instance.placement = placement
  return instance
}

export const page = (inputs: Record<string, InputValue> = {}, id = '1'): FeatureInstance =>
  inst('PageFeature', id, { name: 'Page', ...inputs }, at(ROOT_ID, ROOT_SLOT))

export const resource = (id: string, name = 'Repos', url = 'https://api.example.com/users/me/repos'): FeatureInstance =>
  inst('DataResourceFeature', id, { name, resource: url, operation: 'GET' }, null)

export const model = (...features: FeatureInstance[]): AppModel => ({ version: 2, name: 'test', features })

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value)) deepFreeze(v)
  }
  return value
}
