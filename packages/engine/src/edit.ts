// Pure model edits for the editor (and drag-and-drop). Every operation returns a new model and never mutates its
// arguments. After every structural edit the model order is normalized, so dependencies always come first.

import { createFeatureInstance, referencedIds, type FeatureRegistry } from './feature.js'
import { defaultRegistry } from './features/index.js'
import { generate, type GenerateResult } from './generate.js'
import { buildGraph, topoSort } from './graph.js'
import { resolveInputs } from './inputs.js'
import { ROOT_ID, type AppModel, type FeatureInstance, type InputValue, type Placement } from './types.js'

/** Where to put a feature: a slot, optionally before a sibling already in that slot (otherwise at the end). */
export interface PlacementTarget extends Placement {
  before?: string
}

export class EditError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EditError'
  }
}

export type CanPlace = { ok: true } | { ok: false; reason: string }

export interface EditOptions {
  registry?: FeatureRegistry
}

/** The next free instance id, legacy style: the highest numeric id + 1. */
export function nextInstanceId(model: AppModel): string {
  const numbers = model.features.map((f) => Number(f.id)).filter((n) => Number.isInteger(n) && n >= 0)
  return String(numbers.length === 0 ? 1 : Math.max(...numbers) + 1)
}

/** Instance ids placed (transitively) inside `id`, in model order. */
export function descendantsOf(model: AppModel, id: string): string[] {
  const inside = new Set<string>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const f of model.features) {
      if (f.placement && inside.has(f.placement.parent) && !inside.has(f.id)) {
        inside.add(f.id)
        grew = true
      }
    }
  }
  inside.delete(id)
  return model.features.map((f) => f.id).filter((fid) => inside.has(fid))
}

/** Instance ids a feature depends on through `reference` inputs and `dependencies()` (unknown types: none). */
function dependenciesOf(instance: FeatureInstance, registry: FeatureRegistry): string[] {
  const def = registry.get(instance.feature)
  if (!def) return []
  const inputs = resolveInputs(def.inputs, instance.inputs)
  let extra: string[] = []
  try {
    extra = def.dependencies?.(inputs) ?? []
  } catch {
    // generate() reports this as a feature-error; ordering just ignores it
  }
  return [...referencedIds(def, inputs).map((r) => r.id), ...extra]
}

/**
 * Stable reorder so every feature comes after its parent and the features it references, without changing the page:
 * siblings in a slot keep their relative order (that order is what the page shows), so dependencies are pulled
 * forward rather than dependents pushed back. Features on a dependency cycle go last, in model order. Returns the same
 * model object when nothing moves.
 */
export function normalizeOrder(model: AppModel, options: EditOptions = {}): AppModel {
  const registry = options.registry ?? defaultRegistry
  const ids = model.features.map((f) => f.id)
  const known = new Set(ids)
  const dependencyEdges: [string, string][] = []
  const siblingEdges: [string, string][] = []
  const lastInSlot = new Map<string, string>()
  for (const f of model.features) {
    if (f.placement && f.placement.parent !== ROOT_ID && known.has(f.placement.parent)) dependencyEdges.push([f.placement.parent, f.id])
    for (const dep of dependenciesOf(f, registry)) if (known.has(dep)) dependencyEdges.push([dep, f.id])
    if (f.placement) {
      const slot = `${f.placement.parent}/${f.placement.slot}`
      const previous = lastInSlot.get(slot)
      if (previous !== undefined) siblingEdges.push([previous, f.id])
      lastInSlot.set(slot, f.id)
    }
  }
  // Sibling order can only conflict with dependencies when siblings reference each other in a cycle; then drop it.
  let sorted = topoSort(buildGraph(ids, [...dependencyEdges, ...siblingEdges]))
  if (sorted.cyclic.length > 0 || sorted.blocked.length > 0) sorted = topoSort(buildGraph(ids, dependencyEdges))
  const stuck = new Set([...sorted.cyclic, ...sorted.blocked])
  const order = [...sorted.order, ...ids.filter((id) => stuck.has(id))]
  if (order.every((id, i) => id === ids[i])) return model
  const byId = new Map(model.features.map((f) => [f.id, f]))
  return { ...model, features: order.map((id) => byId.get(id)!) }
}

/**
 * Whether a feature (an existing instance id, or a feature type about to be added) may go into `target`. The slot
 * must exist in the generated document, the feature must be placeable, and it cannot go inside itself.
 */
export function canPlace(
  model: AppModel,
  subject: { id: string } | { feature: string },
  target: PlacementTarget,
  options: EditOptions & { result?: GenerateResult } = {},
): CanPlace {
  const registry = options.registry ?? defaultRegistry
  const instance = 'id' in subject ? model.features.find((f) => f.id === subject.id) : undefined
  if ('id' in subject && !instance) return { ok: false, reason: `Feature ${subject.id} does not exist` }
  const type = instance?.feature ?? (subject as { feature: string }).feature
  const def = registry.get(type)
  if (!def) return { ok: false, reason: `Unknown feature type "${type}"` }
  if (def.placement === 'none') return { ok: false, reason: `${def.name} features are not placed on the page` }

  const result = options.result ?? generate(model, registry)
  if (!result.metadata.targets.some((t) => t.parent === target.parent && t.slot === target.slot)) {
    return { ok: false, reason: `There is no slot "${target.slot}" in ${target.parent === ROOT_ID ? 'the document' : `feature ${target.parent}`}` }
  }
  if (instance && (target.parent === instance.id || descendantsOf(model, instance.id).includes(target.parent))) {
    return { ok: false, reason: 'A feature cannot be placed inside itself' }
  }
  if (target.before !== undefined) {
    const sibling = model.features.find((f) => f.id === target.before)
    if (!sibling || sibling.placement?.parent !== target.parent || sibling.placement.slot !== target.slot) {
      return { ok: false, reason: `Feature ${target.before} is not in that slot` }
    }
  }
  return { ok: true }
}

/** Position for a feature entering `target`: before the given sibling, else after the slot's last sibling, else after the parent. */
function insertionIndex(features: FeatureInstance[], target: PlacementTarget): number {
  if (target.before !== undefined) {
    const i = features.findIndex((f) => f.id === target.before)
    if (i >= 0) return i
  }
  let index = -1
  features.forEach((f, i) => {
    if (f.placement?.parent === target.parent && f.placement.slot === target.slot) index = i
  })
  if (index >= 0) return index + 1
  const parent = features.findIndex((f) => f.id === target.parent)
  return parent >= 0 ? parent + 1 : features.length
}

/**
 * Adds a feature instance. Placeable features go into `target`, which must pass `canPlace` (EditError otherwise);
 * data resources and the like ignore it.
 */
export function insertFeature(
  model: AppModel,
  instance: FeatureInstance,
  target: PlacementTarget | undefined,
  options: EditOptions & { result?: GenerateResult } = {},
): AppModel {
  const registry = options.registry ?? defaultRegistry
  if (model.features.some((f) => f.id === instance.id)) throw new EditError(`Instance id "${instance.id}" is already used`)
  const placeable = registry.get(instance.feature)?.placement !== 'none'
  if (placeable && target) {
    const check = canPlace(model, { feature: instance.feature }, target, options)
    if (!check.ok) throw new EditError(check.reason)
  }
  const { placement: _ignored, ...rest } = instance
  const added: FeatureInstance = placeable && target ? { ...rest, placement: { parent: target.parent, slot: target.slot } } : rest
  const features = [...model.features]
  features.splice(placeable && target ? insertionIndex(features, target) : features.length, 0, added)
  return normalizeOrder({ ...model, features }, options)
}

/** Adds a new instance of `featureType` with default inputs and the next free id. Returns the model and the new id. */
export function addFeature(
  model: AppModel,
  featureType: string,
  target: PlacementTarget | undefined,
  options: EditOptions & { result?: GenerateResult } = {},
): { model: AppModel; id: string } {
  const registry = options.registry ?? defaultRegistry
  const def = registry.get(featureType)
  if (!def) throw new EditError(`Unknown feature type "${featureType}"`)
  const id = nextInstanceId(model)
  return { model: insertFeature(model, createFeatureInstance(def, id), target, options), id }
}

/** Moves a placed feature (and everything inside it) to another slot or position. Throws EditError when `canPlace` would refuse. */
export function moveFeature(model: AppModel, id: string, target: PlacementTarget, options: EditOptions & { result?: GenerateResult } = {}): AppModel {
  const check = canPlace(model, { id }, target, options)
  if (!check.ok) throw new EditError(check.reason)
  if (target.before === id) return model
  const moving = model.features.find((f) => f.id === id)!
  const rest = model.features.filter((f) => f.id !== id)
  const features = [...rest]
  features.splice(insertionIndex(rest, target), 0, { ...moving, placement: { parent: target.parent, slot: target.slot } })
  return normalizeOrder({ ...model, features }, options)
}

export interface RemoveResult {
  model: AppModel
  /** The feature and everything placed inside it, in model order. */
  removed: string[]
  /** Remaining features that referenced a removed feature, with the ids they lose. */
  brokenReferences: { id: string; references: string[] }[]
}

/** Removes a feature and everything placed inside it, and reports which remaining features lose a reference. */
export function removeFeature(model: AppModel, id: string, options: EditOptions = {}): RemoveResult {
  const registry = options.registry ?? defaultRegistry
  if (!model.features.some((f) => f.id === id)) throw new EditError(`Feature ${id} does not exist`)
  const removed = [id, ...descendantsOf(model, id)]
  const gone = new Set(removed)
  const features = model.features.filter((f) => !gone.has(f.id))
  const brokenReferences = features
    .map((f) => ({ id: f.id, references: dependenciesOf(f, registry).filter((dep) => gone.has(dep)) }))
    .filter((b) => b.references.length > 0)
  return { model: { ...model, features }, removed: model.features.map((f) => f.id).filter((fid) => gone.has(fid)), brokenReferences }
}

/** Updates a feature's inputs: `undefined` values remove an input (so it falls back to its default). */
export function updateInputs(model: AppModel, id: string, changes: Record<string, InputValue | undefined>, options: EditOptions = {}): AppModel {
  const index = model.features.findIndex((f) => f.id === id)
  if (index < 0) throw new EditError(`Feature ${id} does not exist`)
  const feature = model.features[index]!
  const inputs: Record<string, InputValue> = { ...feature.inputs }
  for (const [name, value] of Object.entries(changes)) {
    if (value === undefined) delete inputs[name]
    else inputs[name] = value
  }
  const features = [...model.features]
  features[index] = { ...feature, inputs }
  // A changed reference can change dependency order.
  return normalizeOrder({ ...model, features }, options)
}
