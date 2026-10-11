import { describe, expect, it } from 'vitest'
import { createFeatureInstance, defaultRegistry, generate, MAP_HEIGHTS, migrate, googleMapsUrl, renderOutline, type AppModel } from '../src'
import { inst, model, page } from './helpers'

const card = (inputs: Record<string, string>) => {
  const r = generate(model(page(), inst('GoogleMapFeature', 'm', inputs)))
  return { card: r.root.children[0]!.children[0]!, problems: r.diagnostics.map((d) => d.message) }
}

describe('MapFeature', () => {
  it('is a card: title, our street-map drawing (decorative), the address and a link to it in Google Maps', () => {
    const { card: c, problems } = card({ title: 'Where it\'s Warm', address: 'Palm Beach, FL' })
    expect(problems).toEqual([])
    expect(c.kind).toBe('card')
    expect(c.children.map((n) => [n.kind, n.id, n.props])).toEqual([
      ['heading', 'm.title', { text: 'Where it\'s Warm', level: 4, align: 'left' }],
      ['illustration', 'm.map', { name: 'banner/map', alt: '', width: '', align: 'center', aspect: 2 }],
      ['paragraph', 'm.address', { text: 'Palm Beach, FL' }],
      ['link', 'm.link', { text: 'Open in Google Maps', href: 'https://www.google.com/maps/search/?api=1&query=Palm%20Beach%2C%20FL', ariaLabel: 'Open Palm Beach, FL in Google Maps' }],
    ])
  })

  it('names each link with its address, so two maps on a page have different links', () => {
    const r = generate(model(page(), inst('GoogleMapFeature', 'a', { address: 'Palm Beach, FL' }), inst('GoogleMapFeature', 'b', { address: ' 131 Willow Rd. Guilford, CT ' })))
    const names = r.root.children[0]!.children.map((c) => c.children.find((n) => n.kind === 'link')!.props.ariaLabel)
    expect(names).toEqual(['Open Palm Beach, FL in Google Maps', 'Open 131 Willow Rd. Guilford, CT in Google Maps'])
  })

  it('is hidden when disabled', () => {
    const r = generate(model(page(), inst('GoogleMapFeature', 'm', { address: 'Palm Beach, FL', disable: true })))
    expect(r.root.children[0]!.children).toEqual([])
  })

  it('takes a Height, falling back to medium for anything else', () => {
    const aspect = (height: string) => card({ height }).card.children.find((n) => n.kind === 'illustration')!.props.aspect
    expect(aspect('short')).toBe(MAP_HEIGHTS.short)
    expect(aspect('tall')).toBe(MAP_HEIGHTS.tall)
    expect(aspect('huge')).toBe(MAP_HEIGHTS.medium)
  })

  it('without an address shows only the drawing (and title), and says so', () => {
    const { card: c, problems } = card({ title: '', address: '  ' })
    expect(c.children.map((n) => n.kind)).toEqual(['illustration'])
    expect(problems).toEqual(['No address: the map has nothing to show or link to'])
  })

  it('encodes the address into the link, whatever it holds', () => {
    expect(googleMapsUrl('1 Main St & 2nd Ave #4 / "Café"')).toBe('https://www.google.com/maps/search/?api=1&query=1%20Main%20St%20%26%202nd%20Ave%20%234%20%2F%20%22Caf%C3%A9%22')
  })

  it('starts new maps with a title; stored maps without one show none', () => {
    const def = defaultRegistry.get('GoogleMapFeature')!
    expect(createFeatureInstance(def, '9').inputs).toMatchObject({ title: 'Find us', address: '131 Willow Rd. Guilford, CT', height: 'medium' })
    expect(card({}).card.children.map((n) => n.kind)).toEqual(['illustration', 'paragraph', 'link'])
  })
})

describe('migrating the legacy GoogleMap', () => {
  const legacy = (inputs: Record<string, unknown>) =>
    migrate({
      features: [
        { feature: 'PageFeature', id: '1', inputs: { name: 'Page', page_location: { target: '#content_section' } } },
        { feature: 'GoogleMapFeature', id: '6', inputs: { name: 'Home Map', page_location: { target: '#page_container' }, ...inputs } },
      ],
    })

  it('keeps the title and address, dropping its pixel size with a note', () => {
    const r = legacy({ title: 'Too Cold Here', address: '131 Willow Rd. Guilford, CT', height: '200', width: '400' })
    expect(r.model.features[1]!.inputs).toEqual({ name: 'Home Map', disable: false, title: 'Too Cold Here', address: '131 Willow Rd. Guilford, CT' })
    expect(r.notes.map((n) => n.message)).toEqual(['Dropped legacy map styling (height "200", width "400"); it uses our own defaults and the theme'])
  })

  it('leaves a missing address to the default', () => {
    const r = legacy({ title: 'Home' })
    expect(r.model.features[1]!.inputs).not.toHaveProperty('address')
    expect(r.notes).toEqual([])
  })

  it('treats a blank or unusable address like a missing one, with a note', () => {
    for (const address of ['  ', null, { street: 'Main' }]) {
      const r = legacy({ title: 'Home', address })
      expect(r.model.features[1]!.inputs).not.toHaveProperty('address')
      expect(r.notes.map((n) => [n.code, n.message])).toEqual([['invalid-value', 'The map had no address; it shows the default address (131 Willow Rd. Guilford, CT) until one is set']])
    }
  })

  it('is disabled only by a boolean true, as in the legacy app', () => {
    expect(legacy({ address: 'Palm Beach, FL', disable: true }).model.features[1]!.inputs.disable).toBe(true)
    const r = legacy({ address: 'Palm Beach, FL', disable: 'true' })
    expect(r.model.features[1]!.inputs.disable).toBe(false)
    expect(r.notes.map((n) => n.code)).toEqual(['coerced-value'])
  })

  it('upgrades maps stored while the feature was unported, keeping their place', () => {
    const stored = migrate({
      features: [
        { feature: 'PageFeature', id: '1', inputs: { name: 'Page', page_location: { target: '#content_section' } } },
        { feature: 'WidgetFeature', id: '2', inputs: { name: 'w', page_location: { target: '#page_container' } } },
      ],
    }).model
    // A map as an older version stored it: scalar inputs, the legacy instance in cache.
    const old: AppModel = {
      ...stored,
      features: [
        ...stored.features,
        { feature: 'GoogleMapFeature', id: '6', inputs: { name: 'map', title: 'Warm', address: 'Palm Beach, FL', height: '200' }, placement: { parent: '1', slot: 'content' }, cache: { legacy: { feature: 'GoogleMapFeature', id: '6', inputs: { name: 'map', title: 'Warm', address: 'Palm Beach, FL', height: '200', page_location: { target: '#page_container' } } } } },
      ],
    }
    const r = migrate(old)
    expect(r.model.features[2]).toEqual({ feature: 'GoogleMapFeature', id: '6', inputs: { name: 'map', disable: false, title: 'Warm', address: 'Palm Beach, FL' }, placement: { parent: '1', slot: 'content' } })
    expect(r.notes.map((n) => n.code)).toContain('upgraded-feature')
    expect(renderOutline(generate(r.model).root)).toContain('link #6.link')
  })
})
