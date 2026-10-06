import { ROOT_ID, ROOT_SLOT, type AppModel, type GenerateResult, type PlacementTarget } from '@feature-domain/engine'

/**
 * Where the palette adds a new feature, like the legacy editor: into the selected feature if it has slots, else right
 * after the selected feature in its slot, else at the end of the first page. Pages always go at the document root.
 */
export function paletteTarget(model: AppModel, result: GenerateResult, selectedId: string | null, featureType: string): PlacementTarget {
  const root = { parent: ROOT_ID, slot: ROOT_SLOT }
  if (featureType === 'PageFeature') return root
  const targets = result.metadata.targets
  const exists = (parent: string, slot: string) => targets.some((t) => t.parent === parent && t.slot === slot)

  if (selectedId !== null) {
    const own = targets.find((t) => t.parent === selectedId)
    if (own) return { parent: own.parent, slot: own.slot }
    const placement = result.metadata.features.find((f) => f.id === selectedId)?.placement
    if (placement && exists(placement.parent, placement.slot)) {
      const siblings = model.features.filter((f) => f.placement?.parent === placement.parent && f.placement.slot === placement.slot)
      const next = siblings[siblings.findIndex((f) => f.id === selectedId) + 1]
      return next ? { parent: placement.parent, slot: placement.slot, before: next.id } : { parent: placement.parent, slot: placement.slot }
    }
  }
  const page = result.metadata.pages[0]
  const pageSlot = page && targets.find((t) => t.parent === page.id)
  return pageSlot ? { parent: pageSlot.parent, slot: pageSlot.slot } : root
}
