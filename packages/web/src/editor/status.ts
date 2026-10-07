import type { GenerateResult } from '@feature-domain/engine'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The status bar's counts: problems (errors and warnings) and what the model contains. */
export function summarize(result: GenerateResult) {
  const problems = result.diagnostics.filter((d) => d.severity !== 'info').length
  const features = result.metadata.features
  const notPorted = features.filter((f) => f.status === 'unknown').length
  const resources = features.filter((f) => f.feature === 'DataResourceFeature').length
  const themes = features.filter((f) => f.feature === 'ThemeFeature').length
  const placed = features.length - resources - themes

  const problemsLabel = [problems === 0 ? 'No problems' : plural(problems, 'problem'), notPorted > 0 ? `${plural(notPorted, 'feature')} not ported yet` : '']
    .filter(Boolean)
    .join(' · ')
  const countsLabel = [plural(placed, 'feature'), plural(resources, 'data resource'), plural(themes, 'theme')].join(' · ')
  return { problems, notPorted, resources, themes, placed, problemsLabel, countsLabel }
}
