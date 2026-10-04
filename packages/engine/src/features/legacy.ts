// Legacy models store Bootstrap 3 class names as input values. These map them to plain values.
// They can be removed once the phase 3 model migration rewrites stored models.

export type Align = 'left' | 'center' | 'right'

const ALIGN: Record<string, Align> = {
  left: 'left',
  'text-left': 'left',
  'pull-left': 'left',
  center: 'center',
  'text-center': 'center',
  'center-block': 'center',
  right: 'right',
  'text-right': 'right',
  'pull-right': 'right',
}

export function normalizeAlign(value: unknown, fallback: Align): Align {
  return (typeof value === 'string' && ALIGN[value]) || fallback
}

export const TONES = ['muted', 'primary', 'success', 'info', 'warning', 'danger'] as const
export type Tone = (typeof TONES)[number]

/** "text-info" or "bg-info" or "info" -> "info"; anything else -> undefined. */
export function normalizeTone(value: unknown): Tone | undefined {
  if (typeof value !== 'string') return undefined
  const tone = value.replace(/^(text|bg)-/, '')
  return (TONES as readonly string[]).includes(tone) ? (tone as Tone) : undefined
}

export const toneOptions = (withNone: boolean) => [
  ...(withNone ? [{ value: '', text: 'None' }] : []),
  ...TONES.map((t) => ({ value: t, text: t[0]!.toUpperCase() + t.slice(1) })),
]
