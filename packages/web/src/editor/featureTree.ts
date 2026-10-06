import { defaultRegistry, ROOT_ID, type FeatureStatus, type GenerateResult } from '@feature-domain/engine'

export interface TreeItem {
  id: string
  feature: string
  label: string
  status: FeatureStatus
  /** Why the feature isn't generated (skipped, unknown or suppressed). */
  reason?: string
  /** The parent slot it sits in, when the parent has more than one slot (e.g. a container cell "r1c2"). */
  slot?: string
  children: TreeItem[]
}

export interface FeatureTree {
  /** Features placed at the document root, with everything inside them. */
  roots: TreeItem[]
  /** Features that aren't on the page: data resources, and features whose placement is missing or broken. */
  unplaced: TreeItem[]
}

/**
 * The feature tree, built from generation metadata (not the DOM), so features that produced no node
 * (skipped, unknown, suppressed) are still listed. Children keep model order.
 */
export function buildFeatureTree(result: GenerateResult): FeatureTree {
  const meta = result.metadata.features
  const byParent = new Map<string, typeof meta>()
  for (const f of meta) {
    if (!f.placement) continue
    byParent.set(f.placement.parent, [...(byParent.get(f.placement.parent) ?? []), f])
  }
  const slotCount = new Map(meta.map((f) => [f.id, f.slots.length]))

  const reached = new Set<string>()
  const item = (f: (typeof meta)[number]): TreeItem => {
    reached.add(f.id)
    const def = defaultRegistry.get(f.feature)
    const out: TreeItem = {
      id: f.id,
      feature: f.feature,
      label: f.name || def?.name || f.feature,
      status: f.status,
      children: (byParent.get(f.id) ?? []).filter((c) => !reached.has(c.id)).map(item),
    }
    if (f.reason !== undefined) out.reason = f.reason
    if (f.placement && f.placement.parent !== ROOT_ID && (slotCount.get(f.placement.parent) ?? 0) > 1) out.slot = f.placement.slot
    return out
  }

  const roots = (byParent.get(ROOT_ID) ?? []).map(item)
  // One at a time: an unplaced container brings its children along, so they must not be listed again.
  const unplaced: TreeItem[] = []
  for (const f of meta) if (!reached.has(f.id)) unplaced.push(item(f))
  return { roots, unplaced }
}
