import { asInt, asString } from '../inputs.js'
import { fitContrast, hexToOklch, oklchToHex, type Oklch } from './color.js'

// A theme has two layers:
// - settings (accent colour, scheme, sizes, radius, density, shadow) from which `deriveTokens` computes CSS custom
//   properties (`--fd-*`), with every text colour checked for WCAG AA contrast against the surfaces it sits on;
// - styles: a named look per component (panel, table, well) that the renderer exposes as `data-fd-*` attributes and
//   `document.css` implements with one rule block per option.
// A new theme is a combination of settings and styles, so adding one is data, not code.

export const THEME_OPTIONS = {
  scheme: ['light', 'dark'],
  fonts: ['editorial', 'modern', 'system'],
  scale: ['minor-third', 'major-third', 'perfect-fourth'],
  radius: ['none', 'small', 'soft', 'round'],
  density: ['compact', 'comfortable', 'spacious'],
  shadow: ['none', 'soft', 'lifted'],
  panel: ['card', 'bare'],
  table: ['hairline', 'striped'],
  well: ['tint', 'band'],
} as const

type Options = typeof THEME_OPTIONS
export type ThemeChoice<K extends keyof Options> = Options[K][number]

/** The component styles a theme selects; the renderer sets each as a `data-fd-<key>` attribute. */
export const THEME_STYLE_KEYS = ['panel', 'table', 'well'] as const
export type ThemeStyles = { [K in (typeof THEME_STYLE_KEYS)[number]]: ThemeChoice<K> }

export type ThemeParams = { [K in keyof Options]: ThemeChoice<K> } & {
  /** Accent colour, `#rrggbb`. */
  accent: string
  /** Background of emphasised bands (wells with the `band` style), `#rrggbb`. */
  band: string
  /** Body text size in pixels. */
  baseSize: number
}

export const BASE_SIZE_RANGE = { min: 12, max: 22 } as const

/** Warm Editorial: serif display headings, warm cream and ink, a vermilion accent and deep plum bands. */
export const DEFAULT_THEME: Readonly<ThemeParams> = Object.freeze({
  accent: '#e5531a',
  band: '#3a1128',
  scheme: 'light',
  fonts: 'editorial',
  baseSize: 16,
  scale: 'major-third',
  radius: 'soft',
  density: 'comfortable',
  shadow: 'soft',
  panel: 'card',
  table: 'hairline',
  well: 'tint',
})

/** Any stored values as valid theme parameters: unknown or invalid ones fall back to the default theme's. */
export function clampThemeParams(raw: Readonly<Record<string, unknown>>): ThemeParams {
  const out = { ...DEFAULT_THEME } as ThemeParams
  for (const key of Object.keys(THEME_OPTIONS) as (keyof Options)[]) {
    const value = raw[key]
    if ((THEME_OPTIONS[key] as readonly unknown[]).includes(value)) (out as Record<string, unknown>)[key] = value
  }
  for (const key of ['accent', 'band'] as const) {
    if (hexToOklch(asString(raw[key])) !== undefined) out[key] = oklchToHex(hexToOklch(asString(raw[key]))!)
  }
  if (raw.baseSize !== undefined) {
    out.baseSize = Math.min(BASE_SIZE_RANGE.max, Math.max(BASE_SIZE_RANGE.min, asInt(raw.baseSize, DEFAULT_THEME.baseSize)))
  }
  return out
}

export type TokenName = `--fd-${string}`

export interface ThemeTokens {
  scheme: ThemeChoice<'scheme'>
  styles: ThemeStyles
  /** CSS custom properties, applied to the element that carries the theme. */
  vars: Record<TokenName, string>
  /** Changes made to colours the user chose (not derived ones) so text stays readable, in words, for the editor. */
  adjustments: string[]
}

const RATIOS: Record<ThemeChoice<'scale'>, number> = { 'minor-third': 1.2, 'major-third': 1.25, 'perfect-fourth': 1.333 }
/** [small, large, extra large] corner radii in px. */
const RADII: Record<ThemeChoice<'radius'>, [number, number, number]> = {
  none: [0, 0, 0],
  small: [3, 6, 10],
  soft: [8, 20, 28],
  round: [12, 28, 40],
}
const DENSITY: Record<ThemeChoice<'density'>, number> = { compact: 0.75, comfortable: 1, spacious: 1.25 }

const SANS = "'Geist Variable', ui-sans-serif, system-ui, sans-serif"
const MONO = "'Geist Mono Variable', ui-monospace, 'SFMono-Regular', Menlo, monospace"
const SYSTEM = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
const SYSTEM_MONO = "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace"
/** Font families per pairing: display (headings), body and mono, plus how display headings are set. */
const FONTS: Record<ThemeChoice<'fonts'>, { display: string; body: string; mono: string; weight: string; tracking: string }> = {
  editorial: { display: "'Newsreader Variable', Georgia, 'Times New Roman', serif", body: SANS, mono: MONO, weight: '400', tracking: '-0.02em' },
  modern: { display: SANS, body: SANS, mono: MONO, weight: '600', tracking: '-0.03em' },
  system: { display: SYSTEM, body: SYSTEM, mono: SYSTEM_MONO, weight: '650', tracking: '-0.02em' },
}

/** Semantic tone hues (OKLCH degrees) and chroma. `primary` and `info` follow the accent instead. */
const TONE_HUES = { success: [148, 0.13], warning: [70, 0.13], danger: [27, 0.17] } as const

/**
 * Computes the CSS custom properties for a theme. Deterministic, and every text colour reaches 4.5:1 contrast against
 * each surface it is used on (see the contrast pairs in the tests). Colours changed to get there are listed in
 * `adjustments`.
 */
export function deriveTokens(input: Readonly<Record<string, unknown>> = DEFAULT_THEME): ThemeTokens {
  const p = clampThemeParams(input)
  const dark = p.scheme === 'dark'
  const accent = hexToOklch(p.accent)!
  const hue = accent.h
  // Neutrals are tinted very slightly towards the accent, so a warm accent gives warm paper and a cool one cool grey.
  const nc = Math.min(accent.c, 0.2) * 0.065
  const at = (l: number, c: number, h = hue): Oklch => ({ l, c, h })
  const hex = (color: Oklch) => oklchToHex(color)
  const adjustments: string[] = []
  const ensureContrast = (fg: Oklch, backgrounds: string[]) => {
    const fitted = fitContrast(fg, backgrounds)
    if (!fitted.reached) adjustments.push(`A text colour (${fitted.hex}) could not reach 4.5:1 contrast on ${backgrounds.join(', ')}`)
    return fitted.hex
  }

  const bg = hex(dark ? at(0.17, nc) : at(0.972, nc))
  const surface = hex(dark ? at(0.21, nc) : at(1, 0))
  const sunken = hex(dark ? at(0.14, nc) : at(0.935, nc * 2))
  const border = hex(dark ? at(0.31, nc * 1.5) : at(0.9, nc * 2))
  const borderSubtle = hex(dark ? at(0.25, nc * 1.5) : at(0.945, nc * 1.5))
  const accentSoft = hex(dark ? at(0.3, accent.c * 0.35) : at(0.93, accent.c * 0.3))
  const toneSoft = Object.fromEntries(
    Object.entries(TONE_HUES).map(([tone, [h, c]]) => [tone, hex(dark ? at(0.3, c * 0.35, h) : at(0.94, c * 0.3, h))]),
  )
  // Text of any colour can sit on the page, a card, a well or a tinted heading background.
  const surfaces = [bg, surface, sunken, accentSoft, ...Object.values(toneSoft)]

  const accentSolid = hex(accent)
  const onAccent = ensureContrast(at(dark ? 0.15 : 1, 0), [accentSolid])
  const vars: Record<TokenName, string> = {
    '--fd-bg': bg,
    '--fd-surface': surface,
    '--fd-sunken': sunken,
    '--fd-stripe': dark ? sunken : bg,
    '--fd-border': border,
    '--fd-border-subtle': borderSubtle,
    '--fd-ink': ensureContrast(dark ? at(0.96, nc) : at(0.2, nc * 1.2), surfaces),
    '--fd-text': ensureContrast(dark ? at(0.86, nc) : at(0.38, nc * 1.5), surfaces),
    '--fd-muted': ensureContrast(dark ? at(0.72, nc) : at(0.52, nc * 1.5), surfaces),
    '--fd-accent': ensureContrast(at(dark ? Math.max(accent.l, 0.75) : Math.min(accent.l, 0.55), accent.c), surfaces),
    '--fd-accent-solid': accentSolid,
    '--fd-on-accent': onAccent,
    '--fd-accent-soft': accentSoft,
  }
  vars['--fd-primary'] = vars['--fd-info'] = vars['--fd-accent']!
  vars['--fd-primary-bg'] = accentSolid
  vars['--fd-primary-on'] = onAccent
  vars['--fd-info-bg'] = accentSoft
  for (const [tone, [h, c]] of Object.entries(TONE_HUES)) {
    vars[`--fd-${tone}-bg`] = toneSoft[tone]!
    vars[`--fd-${tone}`] = ensureContrast(at(dark ? 0.78 : 0.5, c, h), surfaces)
  }

  // Bands (emphasised wells) get their own set: text on the band colour, whatever scheme the page uses. A mid-lightness
  // band can't carry readable text, so its lightness is kept clearly dark or clearly light.
  const chosenBand = hexToOklch(p.band)!
  const bandIsDark = chosenBand.l < 0.6
  const bandColor = { ...chosenBand, l: bandIsDark ? Math.min(chosenBand.l, 0.4) : Math.max(chosenBand.l, 0.82) }
  const band = hex(bandColor)
  if (bandColor.l !== chosenBand.l) {
    adjustments.push(`Band colour ${p.band} ${bandIsDark ? 'darkened' : 'lightened'} to ${band} so text on it stays readable`)
  }
  const bandRaised = hex({ ...bandColor, l: bandColor.l + (bandIsDark ? 0.05 : -0.04) })
  const bandSurfaces = [band, bandRaised]
  const bc = Math.min(bandColor.c, 0.2) * 0.25
  Object.assign(vars, {
    '--fd-band': band,
    '--fd-band-raised': bandRaised,
    '--fd-band-border': hex({ ...bandColor, l: bandColor.l + (bandIsDark ? 0.12 : -0.1) }),
    '--fd-band-ink': ensureContrast(at(bandIsDark ? 0.97 : 0.18, bc, bandColor.h), bandSurfaces),
    '--fd-band-text': ensureContrast(at(bandIsDark ? 0.9 : 0.3, bc, bandColor.h), bandSurfaces),
    '--fd-band-muted': ensureContrast(at(bandIsDark ? 0.8 : 0.42, bc, bandColor.h), bandSurfaces),
    '--fd-band-accent': ensureContrast(at(bandIsDark ? Math.max(accent.l, 0.76) : Math.min(accent.l, 0.5), accent.c), bandSurfaces),
  })
  for (const [tone, [h, c]] of Object.entries(TONE_HUES)) {
    vars[`--fd-band-${tone}`] = ensureContrast(at(bandIsDark ? 0.8 : 0.45, c, h), bandSurfaces)
  }

  // Type: a modular scale from the base size. h1/h2 shrink on narrow documents (cqi: the document's own width, so the
  // editor's phone-width canvas matches a phone) but never below h3.
  const ratio = RATIOS[p.scale]
  const size = (step: number) => Math.round(p.baseSize * ratio ** step)
  const fonts = FONTS[p.fonts]
  Object.assign(vars, {
    '--fd-font-display': fonts.display,
    '--fd-font-body': fonts.body,
    '--fd-font-mono': fonts.mono,
    '--fd-display-weight': fonts.weight,
    '--fd-display-tracking': fonts.tracking,
    '--fd-size': `${p.baseSize}px`,
    '--fd-size-small': `${Math.round(p.baseSize * 0.8125)}px`,
    '--fd-h1': `clamp(${size(3)}px, 9cqi, ${size(6)}px)`,
    '--fd-h2': `clamp(${size(3)}px, 6cqi, ${size(4)}px)`,
    '--fd-h3': `${size(3)}px`,
    '--fd-h4': `${size(2)}px`,
    '--fd-h5': `${size(1)}px`,
    '--fd-h6': `${p.baseSize}px`,
  })

  const [sm, lg, xl] = RADII[p.radius]
  const shadowColor = dark ? '0 0 0' : '40 20 10'
  Object.assign(vars, {
    '--fd-space': `${8 * DENSITY[p.density]}px`,
    '--fd-radius-sm': `${sm}px`,
    '--fd-radius-lg': `${lg}px`,
    '--fd-radius-xl': `${xl}px`,
    '--fd-shadow': {
      none: 'none',
      soft: `0 1px 2px rgb(${shadowColor} / 0.05), 0 16px 40px -24px rgb(${shadowColor} / 0.25)`,
      lifted: `0 2px 4px rgb(${shadowColor} / 0.08), 0 30px 60px -30px rgb(${shadowColor} / 0.45)`,
    }[p.shadow],
  })

  return { scheme: p.scheme, styles: { panel: p.panel, table: p.table, well: p.well }, vars, adjustments }
}
