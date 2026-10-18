import { deriveTokens, generate, themeParams, validateModel, walkNodes, type AppModel, type DocNode } from '@feature-domain/engine'
import { describe, expect, it } from 'vitest'
import { SAMPLE_SET, sampleModels } from '../src/data/samples'

describe('sampleModels', () => {
  const samples = sampleModels()
  const nodes = (m: AppModel) => {
    const all: DocNode[] = []
    walkNodes(generate(m).root, (n) => all.push(n))
    return all
  }

  it('are the samples written for this app (set 2), in the order the model list shows them', () => {
    expect(SAMPLE_SET).toBe(2)
    expect(samples.map((m) => m.name)).toEqual(['Start here', 'Harbor Coffee', 'Ledgerly pricing', 'Northwind sales', 'Tom Beauvais · projects', 'Shoreline JS meetup'])
  })

  it('are valid, and generate a page with no problems at all, in themes that needed no readability fixes', () => {
    for (const m of samples) {
      expect(validateModel(m), m.name).toEqual([])
      const { root, diagnostics } = generate(m)
      expect(root.children.map((n) => n.kind), m.name).toEqual(['page'])
      expect(diagnostics.map((d) => `${m.name} #${d.featureInstanceId}: ${d.message}`)).toEqual([])
      for (const theme of m.features.filter((f) => f.feature === 'ThemeFeature')) expect(deriveTokens(themeParams(theme.inputs)).adjustments, m.name).toEqual([])
    }
  })

  it('number their features as the editor would, so features added later get the next id', () => {
    for (const m of samples) expect(m.features.map((f) => f.id), m.name).toEqual(m.features.map((_, i) => String(i + 1)))
  })

  it('read like real pages: no placeholder text, and every link and button goes to an https address', () => {
    for (const m of samples) {
      const text = JSON.stringify(m.features.map((f) => f.inputs))
      expect(text, m.name).not.toMatch(/lorem|ipsum|frog|untitled|Your headline goes here|Say what this part/i)
      for (const n of nodes(m).filter((n) => n.kind === 'link' || n.kind === 'button')) {
        const { href } = n.props as { href: string }
        expect(href, m.name).toMatch(/^https:\/\//)
        // Real sites only for real things (the code on GitHub, places on Google Maps, the weather's credit); the café, pricing and meetup
        // are fictional, so their links go to example.com on purpose.
        expect(['github.com', 'www.google.com', 'open-meteo.com', 'example.com'], `${m.name}: ${href}`).toContain(new URL(href).hostname)
      }
    }
  })

  it('give each button on a page its own words, so screen readers can tell them apart', () => {
    for (const m of samples) {
      const words = nodes(m).filter((n) => n.kind === 'button').map((n) => (n.props as { text: string }).text)
      expect(new Set(words).size, `${m.name}: ${words.join(', ')}`).toBe(words.length)
    }
  })

  it('use our own banners and drawings, so they load no pictures from other sites', () => {
    for (const m of samples) expect(nodes(m).filter((n) => n.kind === 'image'), m.name).toEqual([])
    const banners = samples.flatMap((m) => nodes(m).filter((n) => n.kind === 'illustration' && n.props.name.startsWith('banner/') && n.props.name !== 'banner/map'))
    for (const banner of banners) expect(banner.props).toMatchObject({ width: '', alt: '' })
  })

  it('come as fresh copies, so storing one never changes another', () => {
    const [a, b] = [sampleModels(), sampleModels()]
    a[0]!.features[0]!.inputs.name = 'Changed'
    expect(b[0]!.features[0]!.inputs.name).not.toBe('Changed')
  })
})
