import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatDiagnostic, generate, indexNodes, renderOutline, type AppModel, type DocNode } from '../src'
import { deepFreeze } from './helpers'

// Golden tests: the legacy sample models, generated with the ported features.
// Review snapshot diffs carefully: they are the record of how generated output changes.

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const fixtures = [
  'sample.json',
  ...readdirSync(join(repoRoot, 'app_models'))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => `app_models/${f}`),
]

function load(path: string): AppModel {
  const json: unknown = JSON.parse(readFileSync(join(repoRoot, path), 'utf8'))
  // sample.json is a bare feature list; app_models/*.json are full models.
  return Array.isArray(json) ? { name: path, features: json } : (json as AppModel)
}

function allNodes(root: DocNode): DocNode[] {
  return [root, ...root.children.flatMap(allNodes)]
}

describe.each(fixtures)('%s', (path) => {
  const m = deepFreeze(load(path))
  const result = generate(m)

  it('matches the golden document', () => {
    expect(renderOutline(result.root)).toMatchSnapshot()
  })

  it('matches the golden diagnostics', () => {
    expect(result.diagnostics.map(formatDiagnostic)).toMatchSnapshot()
  })

  it('has unique node ids', () => {
    const ids = allNodes(result.root).map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has a node for every generated feature', () => {
    const owners = new Set(allNodes(result.root).map((n) => n.featureInstanceId))
    for (const f of result.metadata.features.filter((f) => f.status === 'generated')) {
      expect(owners.has(f.id), `feature ${f.id}`).toBe(true)
    }
    expect(indexNodes(result.root).has('page_container')).toBe(true)
  })

  it('reports every feature it could not generate', () => {
    const reported = new Set(result.diagnostics.map((d) => d.featureInstanceId))
    const missing = m.features.filter((f) => !result.metadata.features.some((g) => g.id === f.id && g.status === 'generated'))
    for (const f of missing) expect(reported.has(f.id), `feature ${f.id} (${f.feature})`).toBe(true)
  })
})
