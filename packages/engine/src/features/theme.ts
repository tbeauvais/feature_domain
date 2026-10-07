import type { FeatureDefinition } from '../feature.js'
import { asInt, asString, nameInput, type InputDef, type InputOption } from '../inputs.js'
import { BASE_SIZE_RANGE, clampThemeParams, DEFAULT_THEME, deriveTokens, THEME_OPTIONS, type ThemeParams, type ThemeTokens } from '../theme/tokens.js'

const LABELS: Record<string, string> = {
  light: 'Light',
  dark: 'Dark',
  editorial: 'Editorial (serif headings, Geist)',
  modern: 'Modern (Geist)',
  system: 'System fonts',
  'minor-third': 'Minor third (1.2)',
  'major-third': 'Major third (1.25)',
  'perfect-fourth': 'Perfect fourth (1.333)',
  none: 'None',
  small: 'Small',
  soft: 'Soft',
  round: 'Round',
  compact: 'Compact',
  comfortable: 'Comfortable',
  spacious: 'Spacious',
  lifted: 'Lifted',
  card: 'Card',
  bare: 'Bare',
  hairline: 'Hairlines',
  striped: 'Striped',
  tint: 'Tint',
  band: 'Band',
}

const options = (values: readonly string[]): InputOption[] => values.map((value) => ({ value, text: LABELS[value] ?? value }))
const choice = (name: keyof typeof THEME_OPTIONS, label: string): InputDef => ({
  name,
  label,
  type: 'string',
  default: DEFAULT_THEME[name],
  control: 'text-select',
  options: options(THEME_OPTIONS[name]),
})

/** What a Theme provides to the features that reference it (Pages). */
export interface ThemeExports {
  params: ThemeParams
  tokens: ThemeTokens
}

export function isThemeExports(value: unknown): value is ThemeExports {
  const v = value as Partial<ThemeExports> | undefined
  return typeof v?.tokens?.vars === 'object' && typeof v.tokens.styles === 'object' && typeof v.params === 'object'
}

/**
 * A theme: global style parameters for the pages that reference it. Not placed and never disabled (a page whose theme
 * is missing falls back to the default theme). Every parameter is clamped, so any stored value renders.
 */
export const ThemeFeature: FeatureDefinition = {
  type: 'ThemeFeature',
  name: 'Theme',
  icon: 'palette',
  placement: 'none',
  inputs: [
    nameInput('Warm Editorial'),
    { name: 'accent', label: 'Accent', type: 'color', default: DEFAULT_THEME.accent, control: 'color-picker' },
    { name: 'band', label: 'Band colour', type: 'color', default: DEFAULT_THEME.band, control: 'color-picker' },
    choice('scheme', 'Scheme'),
    choice('fonts', 'Fonts'),
    {
      name: 'base_size',
      label: 'Base size (px)',
      type: 'integer',
      default: DEFAULT_THEME.baseSize,
      min: BASE_SIZE_RANGE.min,
      max: BASE_SIZE_RANGE.max,
      control: 'text-input',
    },
    choice('scale', 'Type scale'),
    choice('radius', 'Corners'),
    choice('density', 'Spacing'),
    choice('shadow', 'Shadows'),
    choice('panel', 'Panels'),
    choice('table', 'Tables'),
    choice('well', 'Wells'),
  ],

  generate(inputs, ctx) {
    const raw: Record<string, unknown> = { ...inputs, baseSize: asInt(inputs.base_size, DEFAULT_THEME.baseSize) }
    for (const key of ['accent', 'band'] as const) {
      if (asString(inputs[key]).trim() !== '' && !/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(asString(inputs[key]).trim())) {
        ctx.report('warning', `${key === 'accent' ? 'Accent' : 'Band colour'} "${asString(inputs[key])}" is not a hex colour; using ${DEFAULT_THEME[key]}`)
      }
    }
    const params = clampThemeParams(raw)
    const tokens = deriveTokens(params)
    for (const adjustment of tokens.adjustments) ctx.report('info', adjustment)
    const exports: ThemeExports = { params, tokens }
    return { exports: exports as unknown as Record<string, unknown> }
  },
}
