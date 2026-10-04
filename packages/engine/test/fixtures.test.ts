import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatDiagnostic, generate, migrate, renderOutline, walkNodes, type AppModel, type MigrationNote } from '../src'
import { deepFreeze } from './helpers'

// Golden tests: the legacy sample models, migrated to v2 and generated with the ported features.
// Review snapshot diffs carefully: they are the record of how migration and generated output change.

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const fixtures = [
  'sample.json',
  ...readdirSync(join(repoRoot, 'app_models'))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => `app_models/${f}`),
]

const load = (path: string): unknown => deepFreeze(JSON.parse(readFileSync(join(repoRoot, path), 'utf8')))

/** One line per feature: id, type, placement and inputs (cache omitted). */
function summarize(model: AppModel): string {
  return model.features
    .map((f) => {
      const at = f.placement ? ` @${f.placement.parent}/${f.placement.slot}` : ''
      const cache = f.cache ? ` cache=${Object.keys(f.cache).join(',')}` : ''
      return `${f.id} ${f.feature}${at} ${JSON.stringify(f.inputs)}${cache}`
    })
    .join('\n')
}

const formatNote = (n: MigrationNote) => `${n.severity} ${n.code}${n.featureInstanceId !== undefined ? ` [${n.featureInstanceId}]` : ''}: ${n.message}`

describe.each(fixtures)('%s', (path) => {
  const legacy = load(path)
  const { model, notes } = migrate(legacy)
  const result = generate(model)

  it('migrates to the golden v2 model', () => {
    expect(summarize(model)).toMatchSnapshot()
    expect(notes.map(formatNote)).toMatchSnapshot()
  })

  it('generates the golden document', () => {
    expect(renderOutline(result.root)).toMatchSnapshot()
    expect(result.diagnostics.map(formatDiagnostic)).toMatchSnapshot()
  })

  it('places every feature whose legacy target existed', () => {
    const unplaced = new Set(notes.filter((n) => n.code === 'unresolved-target').map((n) => n.featureInstanceId))
    for (const f of model.features) {
      if (f.feature !== 'DataResourceFeature' && f.feature !== 'SwaggerDataResourceFeature' && !unplaced.has(f.id)) {
        expect(f.placement, `feature ${f.id}`).toBeDefined()
      }
    }
    expect(result.diagnostics.filter((d) => d.code === 'unresolved-placement')).toEqual([])
  })

  it('is idempotent', () => {
    expect(migrate(model).model).toBe(model)
  })

  it('has unique node ids and a node for every generated placed feature', () => {
    const ids: string[] = []
    const owners = new Set<string | undefined>()
    walkNodes(result.root, (n) => {
      ids.push(n.id)
      owners.add(n.featureInstanceId)
    })
    expect(new Set(ids).size).toBe(ids.length)
    for (const f of result.metadata.features.filter((f) => f.status === 'generated' && f.placement)) {
      expect(owners.has(f.id), `feature ${f.id}`).toBe(true)
    }
  })

  it('reports every feature it could not generate', () => {
    const reported = new Set(result.diagnostics.map((d) => d.featureInstanceId))
    const generated = new Set(result.metadata.features.filter((f) => f.status === 'generated').map((f) => f.id))
    for (const f of model.features.filter((f) => !generated.has(f.id))) expect(reported.has(f.id), `feature ${f.id} (${f.feature})`).toBe(true)
  })
})
