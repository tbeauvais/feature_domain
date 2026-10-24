import { coreFeatures, type FeatureDefinition } from '@feature-domain/engine'

/** Palette groups, in display order. Feature types not listed fall into "More", so a new feature is never hidden. */
const GROUPS: { label: string; types: string[] }[] = [
  { label: 'Layout', types: ['PageFeature', 'ContainerFeature', 'PanelFeature', 'SeparatorFeature'] },
  { label: 'Text', types: ['HeaderFeature', 'TextFeature', 'TextWithParagraphFeature', 'ListFeature', 'LinkFeature'] },
  { label: 'Media and cards', types: ['ImageFeature', 'ImageWithParagraphFeature', 'ListGroupFeature', 'ButtonFeature', 'GoogleMapFeature', 'WeatherFeature'] },
  {
    label: 'Data and style',
    types: ['DataResourceFeature', 'SwaggerDataResourceFeature', 'TableFeature', 'GoogleChartFeature', 'FormFeature', 'ThemeFeature'],
  },
]

/**
 * Types not offered yet: a Database table's rows need the Worker's rows API and the page's data store to resolve its
 * addresses, which come in the next two PRs of the Data Apps slice. Models holding one still show it in the tree.
 */
const NOT_YET = new Set(['DatabaseTableFeature'])

/** Short palette labels where the feature's name is long. */
const SHORT: Record<string, string> = { DataResourceFeature: 'Data' }

export interface PaletteGroup {
  label: string
  items: { def: FeatureDefinition; label: string }[]
}

export function paletteGroups(defs: readonly FeatureDefinition[] = coreFeatures): PaletteGroup[] {
  const byType = new Map(defs.filter((d) => !NOT_YET.has(d.type)).map((d) => [d.type, d]))
  const listed = new Set(GROUPS.flatMap((g) => g.types))
  const groups = GROUPS.map((g) => ({ label: g.label, types: g.types.filter((t) => byType.has(t)) }))
  const rest = [...byType.keys()].filter((t) => !listed.has(t))
  if (rest.length > 0) groups.push({ label: 'More', types: rest })
  return groups
    .filter((g) => g.types.length > 0)
    .map((g) => ({ label: g.label, items: g.types.map((t) => ({ def: byType.get(t)!, label: SHORT[t] ?? byType.get(t)!.name })) }))
}
