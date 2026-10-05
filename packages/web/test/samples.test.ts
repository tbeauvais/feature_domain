import { generate } from '@feature-domain/engine'
import { describe, expect, it } from 'vitest'
import { sampleModels } from '../src/data/samples'

describe('sampleModels', () => {
  const samples = sampleModels()

  it('migrates every legacy sample in the repository', () => {
    expect(samples.map((m) => m.name)).toEqual(['Getting Started', 'Buy Deal', 'Data Sample', 'Swagger Data Sample', 'Watson Sample'])
    for (const m of samples) expect(m.version).toBe(2)
  })

  it('generates a page for every sample, with errors only where a feature is not ported yet', () => {
    for (const m of samples) {
      const { root, diagnostics } = generate(m)
      expect(root.children[0]?.kind, m.name).toBe('page')
      const errors = diagnostics.filter((d) => d.severity === 'error').map((d) => `${m.name} #${d.featureInstanceId}: ${d.message}`)
      expect(errors).toEqual(
        m.name === 'Swagger Data Sample' ? ['Swagger Data Sample #43: Input "data_resource" references feature 42, which is not a known feature type'] : [],
      )
    }
  })
})
