import { asString, initialInputs, type InputDef, type Inputs } from './inputs.js'
import type { DocNode, FeatureInstance, Placement, Severity } from './types.js'

/** A generated feature as seen by features that depend on it. */
export interface ResolvedFeature {
  id: string
  feature: string
  name: string
  exports: Readonly<Record<string, unknown>>
}

export interface FeatureContext {
  /** The feature instance id from the model, e.g. "12". */
  instanceId: string
  /** A document node id owned by this instance: the instance id, or `<instanceId>.<part>`. */
  nodeId(part?: string): string
  /**
   * Another generated feature this one depends on. Only features declared through `reference` inputs or
   * `dependencies()` resolve; anything else returns undefined and is reported.
   */
  resolve(instanceId: string): ResolvedFeature | undefined
  /** Reports a feature-specific problem as a diagnostic. */
  report(severity: Severity, message: string): void
}

export interface FeatureOutput {
  /** The feature's subtree. Required for placed features; ignored for features with `placement: 'none'`. */
  node?: DocNode
  /** Values other features can read through `ctx.resolve`, e.g. a data resource's operations. */
  exports?: Record<string, unknown>
}

/**
 * A feature type. `generate` must be pure: same inputs and resolved dependencies, same output; no DOM access and no
 * mutation of its arguments. Inputs arrive with declared defaults filled in.
 */
export interface FeatureDefinition {
  /** Model key, e.g. "TextFeature". */
  type: string
  /** Display name, e.g. "Text". */
  name: string
  icon: string
  inputs: readonly InputDef[]
  /** 'required': the feature is placed in a parent slot. 'none': it only provides exports (e.g. a data resource). */
  placement: 'required' | 'none'
  /** Slot keys this feature provides. Each must appear as a node with a matching `slot` in its output. */
  slots?(inputs: Inputs): string[]
  /** Instance ids this feature depends on beyond its `reference` inputs. */
  dependencies?(inputs: Inputs): string[]
  generate(inputs: Inputs, ctx: FeatureContext): FeatureOutput
}

export type FeatureRegistry = ReadonlyMap<string, FeatureDefinition>

export function createRegistry(defs: readonly FeatureDefinition[]): FeatureRegistry {
  return new Map(defs.map((d) => [d.type, d]))
}

/** A new instance of `def` with its initial inputs, e.g. when a feature is dropped from the palette. */
export function createFeatureInstance(def: FeatureDefinition, id: string, placement?: Placement): FeatureInstance {
  const instance: FeatureInstance = { feature: def.type, id, inputs: initialInputs(def.inputs) }
  if (def.placement === 'required' && placement) instance.placement = { ...placement }
  return instance
}

/** Instance ids referenced by a feature's `reference` inputs (numbers read as ids; empty values ignored). */
export function referencedIds(def: FeatureDefinition, inputs: Inputs): { input: string; id: string }[] {
  const refs: { input: string; id: string }[] = []
  for (const input of def.inputs) {
    const value = asString(inputs[input.name])
    if (input.type === 'reference' && value !== '') refs.push({ input: input.name, id: value })
  }
  return refs
}
