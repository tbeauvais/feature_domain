import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { BADGE_COUNT, BUTTON_SIZES, BUTTON_VARIANTS, deriveTokens, generate, HEADING_BACKGROUNDS, HEADING_COLOURS, PANEL_EMPHASES, THEME_OPTIONS, THEME_STYLE_KEYS } from '@feature-domain/engine'
import { mount } from '@vue/test-utils'
import { computed, defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import DocumentView from '../src/renderer/DocumentView.vue'
import NodeView from '../src/renderer/NodeView.vue'
import { FETCH_JSON } from '../src/renderer/rows'
import { provideTheme } from '../src/renderer/theme'
import { at, inst, model, page } from './helpers'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const css = read('../src/renderer/document.css')
const documentView = read('../src/renderer/DocumentView.vue')

describe('document.css and the theme tokens', () => {
  it('uses only custom properties that the engine emits or the stylesheet itself declares', () => {
    const emitted = new Set(Object.keys(deriveTokens().vars))
    const declared = new Set([...css.matchAll(/(--fd-[\w-]+)\s*:/g)].map((m) => m[1]!))
    const used = new Set([...css.matchAll(/var\((--fd-[\w-]+)/g)].map((m) => m[1]!))
    expect(used.size).toBeGreaterThan(20)
    const undefinedVars = [...used].filter((name) => !emitted.has(name) && !declared.has(name))
    expect(undefinedVars).toEqual([])
    // Stylesheet-local properties must not shadow theme tokens by accident (bands re-point them on purpose).
    const local = [...declared].filter((name) => !emitted.has(name))
    expect(local).toEqual([])
  })

  it('has a rule for every badge tint the theme provides', () => {
    for (let i = 0; i < BADGE_COUNT; i++) expect(css).toContain(`.fd-badge-${i} { background: var(--fd-badge-${i}-bg); color: var(--fd-badge-${i}); }`)
  })

  it('has rules for every button style and size', () => {
    for (const option of [...BUTTON_VARIANTS, ...BUTTON_SIZES.filter((size) => size !== 'medium')]) expect(css).toContain(`.fd-button-${option} {`)
  })

  it('has rules for every header colour and background, and every panel emphasis, except the plain defaults', () => {
    for (const colour of HEADING_COLOURS.filter((c) => c !== 'ink')) expect(css).toContain(`.fd-heading.fd-colour-${colour} {`)
    for (const background of HEADING_BACKGROUNDS.filter((b) => b !== 'none')) {
      expect(css).toContain(`.fd-heading.fd-bg-${background} {`)
      // On the band, the accent and muted colours switch to the band's own readable set.
      if (background === 'band') for (const colour of ['accent', 'muted']) expect(css).toContain(`.fd-heading.fd-bg-band.fd-colour-${colour} {`)
    }
    for (const emphasis of PANEL_EMPHASES.filter((e) => e !== 'normal')) expect(css).toContain(`.fd-panel[data-fd-emphasis='${emphasis}']`)
    // Bootstrap's tones are gone from generated pages.
    expect(css).not.toMatch(/fd-tone-|fd-bg-(primary|success|info|warning|danger)/)
  })

  it('has rules for every component style option the engine offers', () => {
    for (const key of THEME_STYLE_KEYS) {
      for (const option of THEME_OPTIONS[key]) expect(css, `${key}=${option}`).toContain(`[data-fd-${key}='${option}']`)
    }
  })

  it('bundles every web font the theme pairings name, so pages load nothing from other sites', () => {
    const require = createRequire(import.meta.url)
    const imported = [...documentView.matchAll(/^import '(@fontsource[^']+)'/gm)].map((m) => m[1]!)
    const declared = new Set(
      imported.flatMap((spec) => {
        const file = require.resolve(spec.endsWith('.css') ? spec : `${spec}/index.css`)
        return [...readFileSync(file, 'utf8').matchAll(/font-family: '([^']+)'/g)].map((m) => m[1]!)
      }),
    )
    for (const fonts of THEME_OPTIONS.fonts) {
      const vars = deriveTokens({ fonts }).vars
      for (const name of ['--fd-font-display', '--fd-font-body', '--fd-font-mono'] as const) {
        // Quoted names are web fonts we ship; unquoted ones are system or generic families.
        const webFonts = [...vars[name]!.matchAll(/'([^']+Variable)'/g)].map((m) => m[1]!)
        for (const family of webFonts) expect(declared, `${fonts} ${name}`).toContain(family)
      }
    }
  })
})

describe('theme in the renderer', () => {
  const sample = () =>
    model(
      page(),
      inst('PanelFeature', 'p', { heading: 'Panel' }),
      inst('ContainerFeature', 'c', { well: true }),
      inst('DataResourceFeature', 'r', { name: 'Repos', resource: 'https://api.github.com/users/x/repos', operation: 'GET' }, null),
      inst('TableFeature', 't', { data_resource: 'r', fields: ['name'], labels: ['Name'] }, at('p', 'body')),
    )
  const global = { provide: { [FETCH_JSON as symbol]: async () => [] } }

  it('the root carries the default tokens; components carry their own style choice', () => {
    const w = mount(DocumentView, { props: { root: generate(sample()).root }, global })
    const root = w.get('.fd-root')
    const tokens = deriveTokens()
    expect(root.attributes('data-fd-scheme')).toBe('light')
    expect(root.attributes('data-fd-panel')).toBeUndefined()
    const style = (root.element as HTMLElement).style
    expect(style.getPropertyValue('--fd-accent-solid')).toBe('#e5531a')
    expect(style.getPropertyValue('--fd-font-display')).toContain('Newsreader Variable')
    expect(w.get('[data-feature-id="p"]').attributes('data-fd-panel')).toBe(tokens.styles.panel)
    expect(w.get('[data-feature-id="c"]').attributes('data-fd-well')).toBe(tokens.styles.well)
    expect(w.get('.fd-table-block').attributes('data-fd-table')).toBe(tokens.styles.table)
  })

  it('components follow the nearest provided theme', () => {
    const nested = deriveTokens({ panel: 'bare', table: 'striped', well: 'band' })
    const Themed = defineComponent({
      setup(_, { slots }) {
        provideTheme(computed(() => nested))
        return () => h('div', slots.default?.())
      },
    })
    const root = generate(sample()).root
    const w = mount(Themed, { slots: { default: () => h(DocumentView, { root }) }, global })
    // DocumentView's root provides the default again, so to test nesting, render the page subtree directly.
    expect(w.get('[data-feature-id="p"]').attributes('data-fd-panel')).toBe('card')
    const inner = mount(Themed, { slots: { default: () => h(NodeView, { node: root.children[0]! }) }, global })
    expect(inner.get('[data-feature-id="p"]').attributes('data-fd-panel')).toBe('bare')
    expect(inner.get('[data-feature-id="c"]').attributes('data-fd-well')).toBe('band')
    expect(inner.get('.fd-table-block').attributes('data-fd-table')).toBe('striped')
  })

  it('a page with a Theme applies its tokens and components inside use its styles; the root adopts the first page\'s theme', () => {
    const m = model(
      inst('ThemeFeature', 'th', { scheme: 'dark', accent: '#2563eb', panel: 'bare' }, null),
      page({ theme: 'th' }),
      inst('PanelFeature', 'p', { heading: 'Panel' }),
      inst('PageFeature', '2', { name: 'Plain' }, at('$root', 'content')),
      inst('PanelFeature', 'q', { heading: 'Other' }, at('2', 'content')),
    )
    const w = mount(DocumentView, { props: { root: generate(m).root }, global })
    const dark = deriveTokens({ scheme: 'dark', accent: '#2563eb', panel: 'bare' })
    const themed = w.get('[data-feature-id="1"]')
    expect(themed.attributes('data-fd-scheme')).toBe('dark')
    expect((themed.element as HTMLElement).style.getPropertyValue('--fd-bg')).toBe(dark.vars['--fd-bg'])
    expect(w.get('[data-feature-id="p"]').attributes('data-fd-panel')).toBe('bare')
    // The root follows the first page, so the second (unthemed) page inherits that theme too.
    expect(w.get('.fd-root').attributes('data-fd-scheme')).toBe('dark')
    expect(w.get('[data-feature-id="2"]').attributes('data-fd-scheme')).toBeUndefined()
    expect(w.get('[data-feature-id="q"]').attributes('data-fd-panel')).toBe('bare')
  })

  it('a second page can use a different theme from the first', () => {
    const m = model(
      page(),
      inst('ThemeFeature', 'th', { panel: 'bare' }, null),
      inst('PageFeature', '2', { name: 'Themed', theme: 'th' }, at('$root', 'content')),
      inst('PanelFeature', 'p', { heading: 'One' }),
      inst('PanelFeature', 'q', { heading: 'Two' }, at('2', 'content')),
    )
    const w = mount(DocumentView, { props: { root: generate(m).root }, global })
    expect(w.get('[data-feature-id="p"]').attributes('data-fd-panel')).toBe('card')
    expect(w.get('[data-feature-id="q"]').attributes('data-fd-panel')).toBe('bare')
  })

  it('a band well inside a themed page uses that theme\'s band colours', () => {
    const m = model(
      inst('ThemeFeature', 'th', { band: '#123456', well: 'band' }, null),
      page({ theme: 'th' }),
      inst('ContainerFeature', 'c', { well: true }),
    )
    const w = mount(DocumentView, { props: { root: generate(m).root }, global })
    const themed = deriveTokens({ band: '#123456', well: 'band' })
    expect(w.get('[data-feature-id="c"]').attributes('data-fd-well')).toBe('band')
    // The page sets the band tokens the well's rule re-points to; the root (first page's theme) matches.
    expect((w.get('[data-feature-id="1"]').element as HTMLElement).style.getPropertyValue('--fd-band')).toBe(themed.vars['--fd-band'])
    expect(css).toMatch(/\.fd-well\[data-fd-well='band'\] \{[^}]*--fd-text: var\(--fd-band-text\)/)
  })

  it('the root takes its theme from the first actual page, skipping placeholders', () => {
    const m = model(
      inst('ThemeFeature', 'th', { scheme: 'dark' }, null),
      inst('UnportedFeature', 'u', {}, at('$root', 'content')),
      inst('PageFeature', '2', { name: 'Themed', theme: 'th' }, at('$root', 'content')),
    )
    const root = generate(m, undefined, { placeholders: true }).root
    expect(root.children.map((c) => c.kind)).toEqual(['placeholder', 'page'])
    const w = mount(DocumentView, { props: { root }, global })
    expect(w.get('.fd-root').attributes('data-fd-scheme')).toBe('dark')
  })
})
