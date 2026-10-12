import { ROOT_ID, type AppModel, type FeatureInstance, type InputValue, type Placement } from '@feature-domain/engine'

/**
 * Builds a sample model: features get the next numeric id as they are added (as the editor gives them), in the order
 * added, so dependencies (themes, data resources) are added first and siblings in page order.
 */
export function sample(name: string, build: (add: Add) => void): AppModel {
  const features: FeatureInstance[] = []
  const add: Add = (feature, inputs, placement) => {
    const instance: FeatureInstance = { feature, id: String(features.length + 1), inputs }
    if (placement) instance.placement = placement
    features.push(instance)
    return instance.id
  }
  build(add)
  return { version: 2, name, features }
}

export type Add = (feature: string, inputs: Record<string, InputValue>, placement?: Placement) => string

/** The document's content slot (where a page goes), a feature's content slot, a container's cell, a panel's body. */
export const root = (): Placement => ({ parent: ROOT_ID, slot: 'content' })
export const inPage = (page: string): Placement => ({ parent: page, slot: 'content' })
export const inCell = (container: string, row: number, column: number): Placement => ({ parent: container, slot: `r${row}c${column}` })
export const inPanel = (panel: string): Placement => ({ parent: panel, slot: 'body' })
