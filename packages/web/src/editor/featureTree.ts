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
  /** Short type label shown at the end of the row, e.g. "Table", or "Data" for a data resource. */
  type: string
  /** Extra context shown instead of the type: the theme a page uses. */
  detail?: string
  children: TreeItem[]
}

export interface FeatureTree {
  /** Features placed at the document root, with everything inside them. */
  roots: TreeItem[]
  /** Features that are never placed, by design: data resources and themes. */
  resources: TreeItem[]
  /** Features that should be on the page but aren't: their placement is missing or broken. */
  unplaced: TreeItem[]
}

const TYPE_LABELS: Record<string, string> = { DataResourceFeature: 'Data' }

/** How many features sit inside an item, at any depth (shown on collapsed rows). */
export function descendantCount(item: TreeItem): number {
  return item.children.reduce((n, child) => n + 1 + descendantCount(child), 0)
}

/** Ids of the items above `id`, outermost first, or undefined if it isn't in the tree. */
export function ancestorsOf(items: TreeItem[], id: string, path: string[] = []): string[] | undefined {
  for (const item of items) {
    if (item.id === id) return path
    const found = ancestorsOf(item.children, id, [...path, item.id])
    if (found) return found
  }
  return undefined
}

/** Ids of every item that has children (what "Collapse all" collapses). */
export function parentIds(items: TreeItem[]): string[] {
  return items.flatMap((item) => (item.children.length > 0 ? [item.id, ...parentIds(item.children)] : []))
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
  const byId = new Map(meta.map((f) => [f.id, f]))
  /** The name of the Theme a page uses, if it references one that exists. */
  const themeName = (f: (typeof meta)[number]) => {
    const theme = f.feature === 'PageFeature' ? f.references.map((id) => byId.get(id)).find((t) => t?.feature === 'ThemeFeature') : undefined
    return theme && (theme.name || 'Theme')
  }

  const reached = new Set<string>()
  const item = (f: (typeof meta)[number]): TreeItem => {
    reached.add(f.id)
    const def = defaultRegistry.get(f.feature)
    const out: TreeItem = {
      id: f.id,
      feature: f.feature,
      label: f.name || def?.name || f.feature,
      status: f.status,
      type: TYPE_LABELS[f.feature] ?? def?.name ?? f.feature.replace(/Feature$/, ''),
      children: (byParent.get(f.id) ?? []).filter((c) => !reached.has(c.id)).map(item),
    }
    if (f.reason !== undefined) out.reason = f.reason
    const detail = themeName(f)
    if (detail !== undefined) out.detail = detail
    if (f.placement && f.placement.parent !== ROOT_ID && (slotCount.get(f.placement.parent) ?? 0) > 1) out.slot = f.placement.slot
    return out
  }

  const roots = (byParent.get(ROOT_ID) ?? []).map(item)
  // One at a time: an unplaced container brings its children along, so they must not be listed again.
  const resources: TreeItem[] = []
  const unplaced: TreeItem[] = []
  for (const f of meta) {
    if (reached.has(f.id)) continue
    if (defaultRegistry.get(f.feature)?.placement === 'none') resources.push(item(f))
    else unplaced.push(item(f))
  }
  return { roots, resources, unplaced }
}
