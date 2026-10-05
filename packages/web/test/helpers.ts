import { ROOT_ID, type AppModel, type FeatureInstance, type InputValue, type Placement } from '@feature-domain/engine'

export const at = (parent: string, slot: string): Placement => ({ parent, slot })

export function inst(feature: string, id: string, inputs: Record<string, InputValue> = {}, placement: Placement | null = at('1', 'content')): FeatureInstance {
  const instance: FeatureInstance = { feature, id, inputs: { name: `${feature} ${id}`, ...inputs } }
  if (placement) instance.placement = placement
  return instance
}

export const page = (inputs: Record<string, InputValue> = {}): FeatureInstance => inst('PageFeature', '1', { name: 'Page', ...inputs }, at(ROOT_ID, 'content'))

export const model = (...features: FeatureInstance[]): AppModel => ({ version: 2, name: 'test', features })

/** A Storage backed by a Map, so tests never touch the real localStorage. */
export class MemoryStorage implements Storage {
  private items = new Map<string, string>()
  get length() {
    return this.items.size
  }
  clear() {
    this.items.clear()
  }
  getItem(key: string) {
    return this.items.get(key) ?? null
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.items.delete(key)
  }
  setItem(key: string, value: string) {
    this.items.set(key, String(value))
  }
}
