import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { deriveTokens, generate, THEME_OPTIONS, THEME_STYLE_KEYS } from '@feature-domain/engine'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DocumentView from '../src/renderer/DocumentView.vue'
import { model, page } from './helpers'

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
    expect(local).toEqual(['--fd-panel-tone'])
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

describe('RootNode', () => {
  it('applies the default theme as custom properties and style attributes', () => {
    const w = mount(DocumentView, { props: { root: generate(model(page())).root } })
    const root = w.get('.fd-root')
    const tokens = deriveTokens()
    expect(root.attributes()).toMatchObject({
      'data-fd-scheme': 'light',
      'data-fd-panel': tokens.styles.panel,
      'data-fd-table': tokens.styles.table,
      'data-fd-well': tokens.styles.well,
    })
    const style = (root.element as HTMLElement).style
    expect(style.getPropertyValue('--fd-accent-solid')).toBe('#e5531a')
    expect(style.getPropertyValue('--fd-font-display')).toContain('Newsreader Variable')
  })
})
