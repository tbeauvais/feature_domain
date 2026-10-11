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

  it('generates a page for every sample, with no errors', () => {
    for (const m of samples) {
      const { root, diagnostics } = generate(m)
      expect(root.children[0]?.kind, m.name).toBe('page')
      expect(diagnostics.filter((d) => d.severity === 'error').map((d) => `${m.name} #${d.featureInstanceId}: ${d.message}`)).toEqual([])
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

  it('labels the legacy repo tables\' date column "Updated", unless the labels were changed', () => {
    const labeled = (labels: string[]) => model(page(), inst('TableFeature', 't', { fields: ['name', 'description', 'language', 'updated_at'], filters: ['', '', '', ''], labels }))
    expect(upgradeSample(labeled(['Name', 'Description', 'Language', 'Updated At'])).features[1]!.inputs.labels).toEqual(['Name', 'Description', 'Language', 'Updated'])
    const mine = labeled(['Name', 'About', 'Language', 'Updated At'])
    expect(upgradeSample(mine)).toBe(mine)
  })

  it('fixes the legacy typo in Getting Started\'s headline, and leaves other headers alone', () => {
    const typo = model(page(), inst('HeaderFeature', 'h', { text: 'Here is some content for ya...gfdgfd' }))
    expect(upgradeSample(typo).features[1]!.inputs.text).toBe('Here is some content for ya...')
    for (const text of ['My own headline', 'toString']) {
      const mine = model(page(), inst('HeaderFeature', 'h', { text }))
      expect(upgradeSample(mine)).toBe(mine)
    }
  })

  it('makes the Sales API answer with sample sales, since its server is gone, and its table lists them', () => {
    const swagger = sampleModels().find((m) => m.name === 'Swagger Data Sample')!
    const sales = swagger.features.find((f) => f.feature === 'SwaggerDataResourceFeature')!
    expect(sales.inputs.source).toBe('sample')
    expect(JSON.parse(sales.inputs.sample_rows as string)).toHaveLength(5)
    const nodes: DocNode[] = []
    walkNodes(generate(swagger).root, (n) => nodes.push(n))
    const table = nodes.find((n) => n.kind === 'table')!
    expect(table.props).toMatchObject({ source: { operation: 'GET /v1/sales', rows: expect.arrayContaining([expect.objectContaining({ name: 'Avery Chen' })]) } })
  })

  it('shows the Swagger sample\'s amounts as dollars, in its table and its chart', () => {
    const swagger = sampleModels().find((m) => m.name === 'Swagger Data Sample')!
    expect(swagger.features.find((f) => f.feature === 'TableFeature')!.inputs.filters).toEqual(['', '', 'currency'])
    expect(swagger.features.find((f) => f.feature === 'GoogleChartFeature')!.inputs.value_format).toBe('currency')
    const nodes: DocNode[] = []
    walkNodes(generate(swagger).root, (n) => nodes.push(n))
    expect(nodes.find((n) => n.kind === 'table')!.props).toMatchObject({ columns: [{ field: 'id' }, { field: 'name' }, { field: 'amount', filter: 'currency' }] })
  })

  it('makes the Swagger sample\'s Add Sale form require a name and an amount', () => {
    const swagger = sampleModels().find((m) => m.name === 'Swagger Data Sample')!
    expect(swagger.features.find((f) => f.feature === 'FormFeature')!.inputs.required_fields).toEqual(['name', 'amount'])
    const mine = model(page(), inst('FormFeature', 'f', { name: 'Add Sale', operation: 'POST /v1/sales', required_fields: [] }))
    expect(upgradeSample(mine)).toBe(mine)
  })

  it('titles the Swagger sample\'s sales chart and draws it as columns, leaving charts of the user\'s own alone', () => {
    const swagger = sampleModels().find((m) => m.name === 'Swagger Data Sample')!
    expect(swagger.features.find((f) => f.feature === 'GoogleChartFeature')!.inputs).toMatchObject({ title: 'Sales by person', chart_type: 'column', value_field: 'amount' })
    const mine = model(page(), inst('GoogleChartFeature', 'c', { name: 'Sales Chart', chart_type: 'pie', value_field: 'amount', title: 'Mine' }))
    expect(upgradeSample(mine)).toBe(mine)
  })

  it('upgrades a Swagger sample stored before the API spec was ported: migrated, then answering with sample sales', () => {
    const legacy = { feature: 'SwaggerDataResourceFeature', id: '42', inputs: { name: 'Sales API', resource: 'http://sales-api.mybluemix.net/swagger_doc/sales.json' }, cache: { swagger: { swaggerVersion: '1.2', apis: [], basePath: 'http://sales-api.mybluemix.net' } } }
    const stored = model(page(), { feature: 'SwaggerDataResourceFeature', id: '42', inputs: { name: 'Sales API', resource: legacy.inputs.resource }, cache: { legacy } })
    const upgraded = upgradeSample(stored)
    expect(upgraded.features[1]!.inputs).toMatchObject({ spec_url: legacy.inputs.resource, source: 'sample' })
    expect(upgraded.features[1]!.cache).toBeUndefined()
    expect(upgradeSample(upgraded)).toBe(upgraded)
    // An API spec of the user's own is left alone.
    const mine = model(page(), inst('SwaggerDataResourceFeature', 's', { spec_url: 'https://mine.test/openapi.json' }, null))
    expect(upgradeSample(mine)).toBe(mine)
  })

  it('brings the seeded samples fully up to date, so a second pass changes nothing', () => {
    for (const sample of sampleModels()) expect(upgradeSample(sample)).toBe(sample)
    const texts = sampleModels().flatMap((m) => m.features.map((f) => JSON.stringify(f.inputs)))
    expect(texts.join(' ')).not.toMatch(/gfdgfd|Updated At/)
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
