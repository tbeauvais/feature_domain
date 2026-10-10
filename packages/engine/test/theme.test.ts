import { describe, expect, it } from 'vitest'
import {
  clampThemeParams,
  contrast,
  DEFAULT_THEME,
  deriveTokens,
  fitContrast,
  hexToOklch,
  oklchToHex,
  THEME_OPTIONS,
  type ThemeParams,
  type ThemeTokens,
} from '../src/index.js'

/** Seeded PRNG (mulberry32) so the property tests are reproducible. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomParams(random: () => number): ThemeParams {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)]!
  const color = () => `#${Math.floor(random() * 0xffffff).toString(16).padStart(6, '0')}`
  const raw: Record<string, unknown> = { accent: color(), band: color(), baseSize: 12 + Math.floor(random() * 11) }
  for (const [key, options] of Object.entries(THEME_OPTIONS)) raw[key] = pick(options)
  return clampThemeParams(raw)
}

const v = (t: ThemeTokens, name: string) => {
  const value = t.vars[`--fd-${name}`]
  if (value === undefined) throw new Error(`missing --fd-${name}`)
  return value
}

/**
 * Every text colour and the surfaces it is drawn on, as used by document.css. Keep this in step with the stylesheet:
 * a new `color:` (or a text colour on a new `background:`) there needs its pair here, or the contrast check below
 * won't cover it.
 */
function contrastPairs(t: ThemeTokens): [string, string, string, string][] {
  const pairs: [string, string, string, string][] = []
  const add = (fg: string, bgs: string[]) => {
    for (const bg of bgs) pairs.push([fg, bg, v(t, fg), v(t, bg)])
  }
  const page = ['bg', 'surface', 'sunken', 'stripe', 'info-bg', 'success-bg', 'warning-bg', 'danger-bg']
  for (const fg of ['ink', 'text', 'muted', 'accent', 'primary', 'info', 'success', 'warning', 'danger']) add(fg, page)
  add('accent', ['accent-soft']) // soft buttons
  add('on-accent', ['accent-solid'])
  add('primary-on', ['primary-bg'])
  for (const fg of ['ink', 'text', 'muted', 'accent', 'success', 'warning', 'danger']) add(`band-${fg}`, ['band', 'band-raised'])
  return pairs
}

const L = (hex: string) => hexToOklch(hex)!.l

describe('colour maths', () => {
  it('round-trips hex through OKLCH', () => {
    for (const hex of ['#000000', '#ffffff', '#e5531a', '#3a1128', '#2563eb', '#808080']) {
      expect(oklchToHex(hexToOklch(hex)!)).toBe(hex)
    }
  })

  it('round-trips 2,000 random colours', () => {
    const random = rng(99)
    for (let i = 0; i < 2000; i++) {
      const hex = `#${Math.floor(random() * 0x1000000).toString(16).padStart(6, '0')}`
      expect(oklchToHex(hexToOklch(hex)!)).toBe(hex)
    }
  })

  it('reports when a contrast target cannot be reached', () => {
    // Mid grey against both black and white: no colour reaches 4.5:1 on both.
    expect(fitContrast({ l: 0.6, c: 0, h: 0 }, ['#000000', '#ffffff']).reached).toBe(false)
    expect(fitContrast({ l: 0.6, c: 0, h: 0 }, ['#ffffff'])).toEqual({ hex: expect.any(String), reached: true })
  })

  it('maps out-of-gamut colours into sRGB keeping lightness and hue', () => {
    const vivid = { l: 0.7, c: 0.4, h: 145 }
    const mapped = hexToOklch(oklchToHex(vivid))!
    expect(mapped.l).toBeCloseTo(0.7, 1)
    expect(Math.abs(mapped.h - 145)).toBeLessThan(3)
    expect(mapped.c).toBeLessThan(0.4)
  })

  it('computes WCAG contrast', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
  })

  it('rejects malformed colours', () => {
    expect(hexToOklch('red')).toBeUndefined()
    expect(hexToOklch('#12')).toBeUndefined()
    expect(hexToOklch('#abc')).toEqual(hexToOklch('#aabbcc'))
  })
})

describe('clampThemeParams', () => {
  it('returns the default theme for empty or invalid input', () => {
    expect(clampThemeParams({})).toEqual(DEFAULT_THEME)
    expect(clampThemeParams({ accent: 'red', scheme: 'sepia', baseSize: 'big', panel: 7 })).toEqual(DEFAULT_THEME)
  })

  it('keeps valid values and clamps the base size', () => {
    const p = clampThemeParams({ accent: '#ABC', scheme: 'dark', baseSize: 99, table: 'striped' })
    expect(p).toMatchObject({ accent: '#aabbcc', scheme: 'dark', baseSize: 22, table: 'striped' })
    expect(clampThemeParams({ baseSize: 3 }).baseSize).toBe(12)
  })
})

describe('deriveTokens', () => {
  it('derives the default theme (Warm Editorial)', () => {
    const t = deriveTokens()
    expect(t.scheme).toBe('light')
    expect(t.styles).toEqual({ panel: 'card', table: 'hairline', well: 'tint' })
    expect(v(t, 'accent-solid')).toBe('#e5531a')
    expect(v(t, 'band')).toBe('#3a1128')
    expect(v(t, 'font-display')).toMatch(/^'Newsreader Variable'/)
    expect(v(t, 'size')).toBe('16px')
  })

  it('reports colours it changed for readability', () => {
    expect(deriveTokens().adjustments).toEqual([])
    expect(deriveTokens({ band: '#808080' }).adjustments).toContain('Band colour #808080 darkened to #484848 so text on it stays readable')
    expect(deriveTokens({ band: '#999999' }).adjustments.some((a) => a.startsWith('Band colour #999999 lightened'))).toBe(true)
    expect(deriveTokens({ accent: '#1d4ed8' }).adjustments).toEqual([])
  })

  it('is deterministic and does not depend on key order', () => {
    const p = randomParams(rng(7))
    const reversed = Object.fromEntries(Object.entries(p).reverse())
    expect(deriveTokens(p)).toEqual(deriveTokens(p))
    expect(deriveTokens(reversed)).toEqual(deriveTokens(p))
  })

  it('every text colour reaches 4.5:1 on its surfaces, for 3000 random themes', () => {
    const random = rng(42)
    for (let i = 0; i < 3000; i++) {
      const params = randomParams(random)
      const t = deriveTokens(params)
      for (const [fg, bg, fgHex, bgHex] of contrastPairs(t)) {
        const ratio = contrast(fgHex, bgHex)
        if (ratio < 4.5) throw new Error(`${fg} ${fgHex} on ${bg} ${bgHex} is ${ratio.toFixed(2)}:1 for ${JSON.stringify(params)}`)
      }
      expect(t.adjustments.filter((a) => a.includes('could not reach'))).toEqual([])
    }
  })

  it('orders neutral lightness monotonically from ink to page', () => {
    const random = rng(3)
    for (let i = 0; i < 200; i++) {
      const params = randomParams(random)
      const t = deriveTokens(params)
      const ramp = ['ink', 'text', 'muted', 'border', 'bg'].map((n) => L(v(t, n)))
      const ordered = params.scheme === 'light' ? [...ramp].sort((a, b) => a - b) : [...ramp].sort((a, b) => b - a)
      expect(ramp, JSON.stringify(params)).toEqual(ordered)
    }
  })

  it('every value is a non-empty string and type sizes grow from h6 to h3', () => {
    const t = deriveTokens(randomParams(rng(11)))
    for (const value of Object.values(t.vars)) expect(value.length).toBeGreaterThan(0)
    const px = (n: string) => parseInt(v(t, n), 10)
    expect(px('h6')).toBeLessThan(px('h5'))
    expect(px('h5')).toBeLessThan(px('h4'))
    expect(px('h4')).toBeLessThan(px('h3'))
  })

  it('emits the same token names for every theme', () => {
    const names = Object.keys(deriveTokens().vars).sort()
    const random = rng(5)
    for (let i = 0; i < 20; i++) expect(Object.keys(deriveTokens(randomParams(random)).vars).sort()).toEqual(names)
  })
})
