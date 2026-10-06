import { canPlace, type AppModel, type GenerateResult, type PlacementTarget } from '@feature-domain/engine'

/** What is being dragged: a feature already on the page, or a new feature from the palette. */
export type DragSource = { kind: 'feature'; id: string } | { kind: 'palette'; featureType: string }

/** Where the pointer is: an empty area of a slot, or a feature (before it, after it, or into it). */
export type DropZone =
  | { kind: 'slot'; parent: string; slot: string }
  | { kind: 'feature'; id: string; operation: 'reorder-before' | 'reorder-after' | 'combine' }

export type DropEvaluation =
  | { allowed: true; target: PlacementTarget; noop: boolean }
  | { allowed: false; target: PlacementTarget | null; reason: string }

const sameSlot = (a: { parent: string; slot: string } | undefined, b: { parent: string; slot: string }) => a?.parent === b.parent && a.slot === b.slot

/** Features placed in a slot, in model order (the order the page shows). */
export function siblingsIn(model: AppModel, parent: string, slot: string): string[] {
  return model.features.filter((f) => sameSlot(f.placement, { parent, slot })).map((f) => f.id)
}

/** The slot a feature receives drops "into": its first generated slot. */
export function intoSlot(result: GenerateResult, id: string): { parent: string; slot: string } | undefined {
  const target = result.metadata.targets.find((t) => t.parent === id)
  return target && { parent: target.parent, slot: target.slot }
}

/** The placement a drop zone means, or null when it means nothing (e.g. "into" a feature without slots). */
export function zoneTarget(model: AppModel, result: GenerateResult, zone: DropZone): PlacementTarget | null {
  if (zone.kind === 'slot') return { parent: zone.parent, slot: zone.slot }
  if (zone.operation === 'combine') return intoSlot(result, zone.id) ?? null
  const placement = model.features.find((f) => f.id === zone.id)?.placement
  if (!placement) return null
  if (zone.operation === 'reorder-before') return { parent: placement.parent, slot: placement.slot, before: zone.id }
  const siblings = siblingsIn(model, placement.parent, placement.slot)
  const next = siblings[siblings.indexOf(zone.id) + 1]
  return next === undefined ? { parent: placement.parent, slot: placement.slot } : { parent: placement.parent, slot: placement.slot, before: next }
}

/** Whether moving `id` to `target` would leave it exactly where it is. */
function isNoop(model: AppModel, id: string, target: PlacementTarget): boolean {
  const placement = model.features.find((f) => f.id === id)?.placement
  if (!sameSlot(placement, target)) return false
  const siblings = siblingsIn(model, target.parent, target.slot)
  const next = siblings[siblings.indexOf(id) + 1]
  return target.before === id || target.before === next
}

/** Whether a drop is allowed (via the engine's `canPlace`), and what it would do. */
export function evaluateDrop(model: AppModel, result: GenerateResult, source: DragSource, zone: DropZone): DropEvaluation {
  if (source.kind === 'feature' && zone.kind === 'feature' && zone.id === source.id) {
    const placement = model.features.find((f) => f.id === source.id)?.placement
    return placement ? { allowed: true, target: { parent: placement.parent, slot: placement.slot, before: source.id }, noop: true } : { allowed: false, target: null, reason: 'Not placed' }
  }
  const target = zoneTarget(model, result, zone)
  if (!target) return { allowed: false, target: null, reason: 'Features cannot be placed inside this feature' }
  const subject = source.kind === 'feature' ? { id: source.id } : { feature: source.featureType }
  const check = canPlace(model, subject, target, { result })
  if (!check.ok) return { allowed: false, target, reason: check.reason }
  return { allowed: true, target, noop: source.kind === 'feature' && isNoop(model, source.id, target) }
}
