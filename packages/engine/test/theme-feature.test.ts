import { describe, expect, it } from 'vitest'
import {
  createRegistry,
  defaultRegistry,
  deriveTokens,
  EditError,
  formatDiagnostic,
  generate,
  type DocNodeOf,
  type FeatureDefinition,
  useThemeOnUnthemedPages,
} from '../src'
import { at, deepFreeze, inst, model, page } from './helpers'

const theme = (id: string, inputs: Record<string, string | number> = {}) => inst('ThemeFeature', id, inputs, null)
const pageNode = (root: ReturnType<typeof generate>['root']) => root.children[0] as DocNodeOf<'page'>
const messages = (r: ReturnType<typeof generate>) => r.diagnostics.map(formatDiagnostic)

describe('ThemeFeature', () => {
  it('a page that references a theme carries its tokens', () => {
    const r = generate(deepFreeze(model(theme('t', { accent: '#2563eb', scheme: 'dark', panel: 'bare' }), page({ theme: 't' }))))
    expect(r.diagnostics).toEqual([])
    const props = pageNode(r.root).props
    expect(props.theme).toEqual(deriveTokens({ accent: '#2563eb', scheme: 'dark', panel: 'bare' }))
    expect(r.graph.parents.get('1')).toEqual(['t'])
    expect(r.metadata.features.find((f) => f.id === 't')).toMatchObject({ status: 'generated' })
  })

  it('a page without a theme has none (the renderer applies the default)', () => {
    const r = generate(model(theme('t'), page()))
    expect(pageNode(r.root).props).toEqual({})
  })

  it('maps base_size and clamps every parameter', () => {
    const r = generate(model(theme('t', { base_size: 99, scheme: 'sepia', radius: 'round' }), page({ theme: 't' })))
    const tokens = pageNode(r.root).props.theme!
    expect(tokens.vars['--fd-size']).toBe('22px')
    expect(tokens.scheme).toBe('light')
    expect(tokens.vars['--fd-radius-lg']).toBe('28px')
  })

  it('warns about colours that are not hex, and reports readability adjustments as info', () => {
    const r = generate(model(theme('t', { accent: 'red', band: '#808080' }), page({ theme: 't' })))
    expect(messages(r)).toEqual([
      'warning feature [t]: Accent "red" is not a hex colour; using #e5531a',
      'info feature [t]: Band colour #808080 darkened to #484848 so text on it stays readable',
    ])
  })
})

describe('soft references (Page -> Theme)', () => {
  it('a missing theme is a warning and the page still generates with the default', () => {
    const r = generate(model(page({ theme: '9' }), inst('TextFeature', 'x', { text: 'hi' })))
    expect(messages(r)).toEqual(['warning unresolved-reference [1]: Input "theme" references feature 9, which does not exist; generating without it'])
    expect(pageNode(r.root).props).toEqual({})
    expect(pageNode(r.root).children.map((c) => c.id)).toEqual(['x'])
  })

  it('a reference to the wrong feature type is a warning too', () => {
    const r = generate(model(inst('TextFeature', 'x', { text: 'hi' }), page({ theme: 'x' })))
    expect(messages(r)).toContain('warning unresolved-reference [1]: Input "theme" must reference one of ThemeFeature, not TextFeature; generating without it')
    expect(r.metadata.features.find((f) => f.id === '1')).toMatchObject({ status: 'generated' })
  })

  it('a referenced feature that is suppressed or fails does not skip the referencing feature', () => {
    const Flaky: FeatureDefinition = {
      type: 'ThemeFeature',
      name: 'Flaky theme',
      icon: 'x',
      placement: 'none',
      inputs: [{ name: 'disable', label: 'Disable', type: 'boolean', default: false, control: 'checkbox' }],
      generate: (inputs) => {
        if (inputs.disable === 'throw') throw new Error('boom')
        return { exports: {} }
      },
    }
    const registry = createRegistry([...[...defaultRegistry.values()].filter((d) => d.type !== 'ThemeFeature'), Flaky])
    const suppressed = generate(model(inst('ThemeFeature', 't', { disable: true }, null), page({ theme: 't' })), registry)
    expect(suppressed.metadata.features.find((f) => f.id === '1')).toMatchObject({ status: 'generated' })
    expect(messages(suppressed)).toContain('warning dependency-skipped [1]: Referenced feature t ("ThemeFeature t") is suppressed; generating without it')

    const failed = generate(model(inst('ThemeFeature', 't', { disable: 'throw' }, null), page({ theme: 't' })), registry)
    expect(failed.metadata.features.find((f) => f.id === '1')).toMatchObject({ status: 'generated' })
    expect(messages(failed)).toContain('warning dependency-skipped [1]: Referenced feature t ("ThemeFeature t") was not generated; generating without it')
    expect(pageNode(failed.root).props).toEqual({})
  })

  it('still orders the theme before the page and flags a theme listed after it', () => {
    const r = generate(model(page({ theme: 't' }), theme('t')))
    expect(r.order.indexOf('t')).toBeLessThan(r.order.indexOf('1'))
    expect(messages(r)).toEqual(['warning out-of-order [1]: Listed before feature t ("ThemeFeature t"), which it references'])
    expect(pageNode(r.root).props.theme).toBeDefined()
  })
})

describe('useThemeOnUnthemedPages', () => {
  it('wires a new theme to pages without one (or with a missing one), and leaves themed pages alone', () => {
    const before = deepFreeze(
      model(theme('a'), page({ theme: 'a' }, '1'), page({}, '2'), page({ theme: 'gone' }, '3'), inst('TextFeature', 'x', {}, at('2', 'content')), theme('b')),
    )
    const after = useThemeOnUnthemedPages(before, 'b')
    const themeOf = (id: string) => after.features.find((f) => f.id === id)!.inputs.theme
    expect([themeOf('1'), themeOf('2'), themeOf('3')]).toEqual(['a', 'b', 'b'])
    // The theme moves ahead of the pages that now reference it, without changing the page.
    const ids = after.features.map((f) => f.id)
    expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('2'))
    expect(generate(after).diagnostics.filter((d) => d.severity !== 'info')).toEqual([])
  })

  it('returns the same model when every page already has a theme, and refuses unknown themes', () => {
    const m = model(theme('a'), page({ theme: 'a' }))
    expect(useThemeOnUnthemedPages(m, 'a')).toBe(m)
    expect(() => useThemeOnUnthemedPages(m, 'zz')).toThrow(EditError)
  })
})
