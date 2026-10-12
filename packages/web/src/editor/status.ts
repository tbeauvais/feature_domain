import { DATA_RESOURCE_TYPES, defaultInputs, ThemeFeature, type GenerateResult } from '@feature-domain/engine'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The status bar's counts: problems (errors and warnings) and what the model contains. */
export function summarize(result: GenerateResult) {
  const problems = result.diagnostics.filter((d) => d.severity !== 'info').length
  const features = result.metadata.features
  const unknown = features.filter((f) => f.status === 'unknown').length
  // Data resources of every kind (addresses, sample data, API specs).
  const resources = features.filter((f) => DATA_RESOURCE_TYPES.includes(f.feature)).length
  const themes = features.filter((f) => f.feature === 'ThemeFeature').length
  const placed = features.length - resources - themes

  const problemsLabel = [problems === 0 ? 'No problems' : plural(problems, 'problem'), unknown > 0 ? `${plural(unknown, 'unknown feature')}` : '']
    .filter(Boolean)
    .join(' · ')
  const countsLabel = [plural(placed, 'feature'), plural(resources, 'data resource'), plural(themes, 'theme')].join(' · ')
  return { problems, unknown, resources, themes, placed, problemsLabel, countsLabel }
}

/** The name a new Theme gets, which is also the default theme's look (Warm Editorial). */
export const DEFAULT_THEME_NAME = String(defaultInputs(ThemeFeature.inputs).name ?? 'Default')

/** Which themes style the pages, for the canvas toolbar: e.g. "Theme: Warm", "Warm on 1 of 2 pages". */
export function themeSummary(result: GenerateResult): string {
  const features = result.metadata.features
  const pages = features.filter((f) => f.feature === 'PageFeature')
  const themes = features.filter((f) => f.feature === 'ThemeFeature')
  const usage = themes.map((t) => ({ name: t.name || 'Untitled theme', pages: pages.filter((p) => p.references.includes(t.id)).length })).filter((u) => u.pages > 0)
  const themed = usage.reduce((n, u) => n + u.pages, 0)
  if (themed === 0) return `Default theme (${DEFAULT_THEME_NAME})`
  if (usage.length === 1 && themed === pages.length) return `Theme: ${usage[0]!.name}`
  const parts = usage.map((u) => `${u.name} on ${u.pages} of ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}`)
  if (themed < pages.length) parts.push(`default on ${pages.length - themed}`)
  return `Themes: ${parts.join(' · ')}`
}
