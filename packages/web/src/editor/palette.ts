import { coreFeatures, type FeatureDefinition } from '@feature-domain/engine'

/** Palette groups, in display order. Feature types not listed fall into "More", so a new feature is never hidden. */
const GROUPS: { label: string; types: string[] }[] = [
  { label: 'Layout', types: ['PageFeature', 'ContainerFeature', 'PanelFeature'] },
  { label: 'Content', types: ['HeaderFeature', 'TextFeature', 'ImageFeature', 'ListFeature', 'TableFeature', 'LinkFeature', 'ButtonFeature', 'SeparatorFeature'] },
  { label: 'Data and style', types: ['DataResourceFeature', 'ThemeFeature'] },
]

/** Short palette labels where the feature's name is long. */
const SHORT: Record<string, string> = { DataResourceFeature: 'Data' }

export interface PaletteGroup {
  label: string
  items: { def: FeatureDefinition; label: string }[]
}

export function paletteGroups(defs: readonly FeatureDefinition[] = coreFeatures): PaletteGroup[] {
  const byType = new Map(defs.map((d) => [d.type, d]))
  const listed = new Set(GROUPS.flatMap((g) => g.types))
  const groups = GROUPS.map((g) => ({ label: g.label, types: g.types.filter((t) => byType.has(t)) }))
  const rest = defs.filter((d) => !listed.has(d.type)).map((d) => d.type)
  if (rest.length > 0) groups.push({ label: 'More', types: rest })
  return groups
    .filter((g) => g.types.length > 0)
    .map((g) => ({ label: g.label, items: g.types.map((t) => ({ def: byType.get(t)!, label: SHORT[t] ?? byType.get(t)!.name })) }))
}
