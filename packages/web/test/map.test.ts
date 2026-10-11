import { generate } from '@feature-domain/engine'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DocumentView from '../src/renderer/DocumentView.vue'
import { inst, model, page } from './helpers'

describe('Map', () => {
  it('shows a card with our street-map drawing (decorative, shaped by its Height), the address and a Google Maps link', () => {
    const w = mount(DocumentView, { props: { root: generate(model(page(), inst('GoogleMapFeature', 'm', { title: 'Find us', address: 'Palm Beach, FL', height: 'tall' }))).root } })
    const card = w.get('[data-feature-id="m"]')
    expect(card.classes()).toContain('fd-card')
    expect(card.get('.fd-heading').text()).toBe('Find us')
    const drawing = card.get('.fd-illustration-banner')
    expect(drawing.attributes('aria-hidden')).toBe('true')
    expect(drawing.attributes('role')).toBeUndefined()
    expect((drawing.element as HTMLElement).style.aspectRatio).toBe(`${4 / 3} / 1`)
    expect(drawing.findAll('svg')).toHaveLength(2)
    expect(card.get('.fd-paragraph').text()).toBe('Palm Beach, FL')
    const link = card.get('a')
    expect(link.text()).toBe('Open in Google Maps')
    expect(link.attributes('href')).toBe('https://www.google.com/maps/search/?api=1&query=Palm%20Beach%2C%20FL')
    expect(link.attributes('aria-label')).toBe('Open Palm Beach, FL in Google Maps')
  })
})
