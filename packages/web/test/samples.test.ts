import { generate, walkNodes, type AppModel, type DocNode } from '@feature-domain/engine'
import { describe, expect, it } from 'vitest'
import { sampleModels, upgradeSample } from '../src/data/samples'
import { inst, model, page } from './helpers'

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

  it('shows built-in banners instead of the legacy stock header photos, and keeps the other pictures', () => {
    const kinds = (name: string) => {
      const nodes: DocNode[] = []
      walkNodes(generate(samples.find((m) => m.name === name)!).root, (n) => nodes.push(n))
      return nodes.filter((n) => n.kind === 'image' || n.kind === 'illustration').map((n) => (n.kind === 'illustration' ? n.props.name : n.kind))
    }
    expect(kinds('Data Sample')).toEqual(['banner/blueprint', 'image', 'image'])
    expect(kinds('Buy Deal')).toEqual(['banner/shapes', 'image'])
    expect(kinds('Watson Sample')).toEqual(['banner/data-dots'])
  })
})

describe('upgradeSample', () => {
  const repoTable = (filters: string[]) =>
    model(page(), inst('TableFeature', 't', { fields: ['name', 'description', 'language', 'updated_at'], filters }))

  it('gives the legacy repo tables language badges, plain names and scrolling', () => {
    const upgraded = upgradeSample(repoTable(['uppercase', 'dataLink :data.html_url', '', 'date']))
    expect(upgraded.features[1]!.inputs).toMatchObject({ filters: ['', 'dataLink :data.html_url', 'badge', 'date'], scroll_rows: 10 })
  })

  it('leaves tables the user has changed alone', () => {
    const changed = repoTable(['', 'dataLink :data.html_url', '', 'date'])
    expect(upgradeSample(changed)).toBe(changed)
  })

  const header = 'http://www.baybridgecompanies.com/clipart/pageHeaders/blue_header.jpg'

  it('turns a legacy header photo into its banner, keeping the address for switching back', () => {
    const upgraded = upgradeSample(model(page(), inst('ImageFeature', 'i', { src: header, alt: 'some cool image', responsive: false })))
    expect(upgraded.features[1]!.inputs).toMatchObject({ source: 'illustration', illustration: 'banner/blueprint', banner_height: 'short', responsive: true, alt: '', src: header })
  })

  it('makes banners from the first upgrade short, keeping the illustration chosen', () => {
    const upgraded = upgradeSample(model(page(), inst('ImageFeature', 'i', { src: header, source: 'illustration', illustration: 'banner/shapes' })))
    expect(upgraded.features[1]!.inputs).toMatchObject({ illustration: 'banner/shapes', banner_height: 'short' })
  })

  it('leaves malformed models and features alone instead of throwing', () => {
    const noFeatures = { version: 2, name: 'x' } as unknown as AppModel
    expect(upgradeSample(noFeatures)).toBe(noFeatures)
    const odd = { version: 2, name: 'x', features: [null, { feature: 'ImageFeature', id: '1' }, { feature: 'ImageFeature', id: '2', inputs: { src: 'constructor' } }] } as unknown as AppModel
    expect(upgradeSample(odd)).toBe(odd)
  })

  it('returns the same model when there is nothing to change, including images already switched or chosen by the user', () => {
    for (const m of [
      model(page(), inst('ImageFeature', 'i', { src: 'https://example.com/mine.jpg' })),
      model(page(), inst('ImageFeature', 'i', { src: header, source: 'illustration', illustration: 'spot/map', banner_height: 'tall' })),
      model(page(), inst('ImageFeature', 'i', { src: header, source: 'illustration', illustration: 'spot/map' })),
      model(page(), inst('TextFeature', 't', { src: header })),
    ]) {
      expect(upgradeSample(m)).toBe(m)
    }
  })
})
