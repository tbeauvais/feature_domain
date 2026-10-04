import { defaultInputs, type InputDef, type Inputs } from './inputs'
import type { DocNode, FeatureInstance, PageLocation } from './types'

export interface FeatureContext {
  /** The feature instance id from the model, e.g. "12". */
  instanceId: string
  /** DOM-style id derived from name + instance id, e.g. "my_container_12". */
  domId: string
}

/**
 * A feature type. `generate` must be pure: same inputs, same output, no DOM access and no mutation of `inputs`.
 * It receives stored inputs as-is, so it must handle absent inputs itself; `InputDef.default` is only for new instances.
 */
export interface FeatureDefinition {
  /** Model key, e.g. "TextFeature". */
  type: string
  /** Display name, e.g. "Text". */
  name: string
  icon: string
  inputs: readonly InputDef[]
  /** Target ids (no '#') this feature provides for other features to be placed into. Each must exist in its output. */
  slots?(inputs: Inputs, ctx: FeatureContext): string[]
  generate(inputs: Inputs, ctx: FeatureContext): DocNode
}

export type FeatureRegistry = ReadonlyMap<string, FeatureDefinition>

/** A new instance of `def` with default inputs, e.g. when a feature is dropped from the palette. */
export function createFeatureInstance(def: FeatureDefinition, id: string, location: PageLocation): FeatureInstance {
  return { feature: def.type, id, inputs: { ...defaultInputs(def.inputs), page_location: { ...location } } }
}

export function createRegistry(defs: readonly FeatureDefinition[]): FeatureRegistry {
  return new Map(defs.map((d) => [d.type, d]))
}
