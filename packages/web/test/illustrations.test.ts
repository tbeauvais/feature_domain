import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deriveTokens, generate, ILLUSTRATIONS, type AppModel } from '@feature-domain/engine'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import DocumentView from '../src/renderer/DocumentView.vue'
import { illustrationComponents } from '../src/renderer/illustrations'
import { at, inst, model, page } from './helpers'

const dir = join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/illustrations')
const sources = readdirSync(dir)
  .filter((f) => f.endsWith('.vue'))
  .map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8') }))

const render = (m: AppModel) => mount(DocumentView, { props: { root: generate(m).root } })

describe('illustration drawings', () => {
  it('has a drawing for every illustration in the engine catalogue, and no others', () => {
    expect(Object.keys(illustrationComponents).sort()).toEqual(ILLUSTRATIONS.map((i) => i.id).sort())
    expect(sources).toHaveLength(ILLUSTRATIONS.length)
  })

  it.each(Object.entries(illustrationComponents))('%s is plain SVG: no scripts, handlers or references to other documents', (_, drawing) => {
    const html = mount(drawing).html()
    const svgs = [...html.matchAll(/<svg\b[^>]*>/g)].map((m) => m[0])
    expect(html).toMatch(/^<svg/)
    for (const svg of svgs) expect(svg).toContain('aria-hidden="true"')
    expect(html).not.toMatch(/<(script|foreignObject|image|use|a|iframe|style)\b/i)
    expect(html).not.toMatch(/\son\w+=/i)
    expect(html).not.toMatch(/\b(xlink:)?href=/i)
    // Fills may point at a pattern in the same drawing, nothing else.
    for (const [, target] of html.matchAll(/url\(([^)]*)\)/g)) expect(target).toMatch(/^&quot;?#fd-|^#fd-/)
  })

  it('the dots divider keeps its dots whole while its hairlines reach both edges of the separator', () => {
    const svg = mount(illustrationComponents['divider/dots']).get('svg')
    expect(svg.attributes('style')).toContain('overflow: visible')
    expect(svg.get('path').attributes('d')).toMatch(/^M-\d+ 24 H\d+ M\d+ 24 H\d+$/)
  })

  it('sources bind no event handlers and load nothing', () => {
    for (const { file, text } of sources) {
      expect(text, file).not.toMatch(/\s(@|v-on:)\w+/)
      expect(text, file).not.toMatch(/\bimport\b(?![^\n]*from 'vue')/)
    }
  })

  it('colours only with theme tokens the engine emits (or the current colour)', () => {
    const emitted = new Set(Object.keys(deriveTokens().vars))
    for (const { file, text } of sources) {
      for (const [, name] of text.matchAll(/var\((--[\w-]+)\)/g)) expect(emitted, `${file}: ${name}`).toContain(name)
      // Colours never hard-coded: every fill and stroke is a token, the current colour, a pattern or none.
      for (const [, value] of text.matchAll(/\s(?:fill|stroke)="([^"]*)"/g)) expect(['none', 'currentColor'], file).toContain(value)
      for (const [, style] of text.matchAll(/\sstyle="([^"]*)"/g)) {
        for (const declaration of (style ?? '').split(';')) {
          const [property, value] = declaration.split(':').map((part) => part.trim())
          if (property === 'fill' || property === 'stroke') expect(value, `${file}: ${declaration}`).toMatch(/^(var\(--fd-[\w-]+\)|currentColor|none)$/)
        }
      }
    }
  })

  it('gives pattern ids that are unique when a banner appears twice on a page', () => {
    const Twice = defineComponent(() => () => h('div', [h(illustrationComponents['banner/blueprint']), h(illustrationComponents['banner/blueprint'])]))
    const ids = [...mount(Twice).html().matchAll(/<pattern id="([^"]+)"/g)].map((m) => m[1])
    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(4)
  })
})

describe('illustration nodes', () => {
  it('draw the illustration in a frame of its shape, described by its alt text', () => {
    const w = render(model(page(), inst('ImageFeature', 'i', { source: 'illustration', illustration: 'spot/map', width: '240' })))
    const frame = w.get('[data-feature-id="i"]')
    expect(frame.classes()).toEqual(expect.arrayContaining(['fd-illustration', 'fd-illustration-spot', 'fd-illustration-center']))
    expect(frame.attributes()).toMatchObject({ role: 'img', 'aria-label': 'A folded map with a route to a pin' })
    expect(frame.attributes('style')).toContain('width: 240px')
    expect(frame.attributes('style')).toContain('aspect-ratio: 1.3333')
    expect(frame.find('svg').exists()).toBe(true)
  })

  it('give banners the chosen height as a shape, so it follows the width', () => {
    const frame = render(model(page(), inst('ImageFeature', 'i', { source: 'illustration', banner_height: 'short' }))).get('[data-feature-id="i"]')
    expect(frame.classes()).toContain('fd-illustration-banner')
    expect(frame.attributes('style')).toContain('aspect-ratio: 6')
  })

  it('fill the width when responsive, and hide decorative ones from screen readers', () => {
    const w = render(model(page(), inst('ImageFeature', 'i', { source: 'illustration', responsive: true, decorative: true })))
    const frame = w.get('[data-feature-id="i"]')
    expect(frame.attributes('style')).not.toContain('width')
    expect(frame.attributes()).toMatchObject({ 'aria-hidden': 'true' })
    expect(frame.attributes('role')).toBeUndefined()
  })

  it('show an empty frame for an unknown illustration or a divider', () => {
    for (const illustration of ['banner/nope', 'divider/wave']) {
      const frame = render(model(page(), inst('ImageFeature', 'i', { source: 'illustration', illustration }))).get('[data-feature-id="i"]')
      expect(frame.classes()).toContain('fd-image-empty')
      expect(frame.find('svg').exists()).toBe(false)
    }
  })
})

describe('separator styles', () => {
  it('draw a divider illustration in the chosen colour, or a plain rule', () => {
    const w = render(
      model(page(), inst('SeparatorFeature', 's', { style: 'wave', color: '#123456', width: 50 }), inst('SeparatorFeature', 'l', {}, at('1', 'content'))),
    )
    const divider = w.get('[data-feature-id="s"]')
    expect(divider.element.tagName).toBe('DIV')
    expect(divider.attributes()).toMatchObject({ role: 'separator' })
    expect(divider.classes()).toContain('fd-separator-divider')
    expect(divider.attributes('style')).toContain('color: rgb(18, 52, 86)')
    expect(divider.attributes('style')).toContain('width: 50%')
    expect(divider.find('svg path').exists()).toBe(true)
    expect(w.get('[data-feature-id="l"]').element.tagName).toBe('HR')
  })
})
