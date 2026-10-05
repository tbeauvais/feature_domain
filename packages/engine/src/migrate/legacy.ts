// Knowledge of the legacy (AngularJS/CoffeeScript) model format. Only the migration uses this.

import { TONES, type Align, type Tone } from '../types.js'

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

/** Bootstrap alignment classes -> plain values. */
export function normalizeAlign(value: unknown, fallback: Align): Align {
  return (typeof value === 'string' && ALIGN[value]) || fallback
}

/** "text-info", "bg-info", "panel-info" or "info" -> "info"; anything else -> undefined. */
export function normalizeTone(value: unknown): Tone | undefined {
  if (typeof value !== 'string') return undefined
  const tone = value.replace(/^(text|bg|panel)-/, '')
  return (TONES as readonly string[]).includes(tone) ? (tone as Tone) : undefined
}

/**
 * The legacy DOM id of a feature instance (`BaseFeature.instanceId`): name + "_" + id, whitespace to underscores,
 * lowercased. Legacy string concatenation turned a missing name into "undefined".
 */
export function legacyDomId(name: unknown, id: string): string {
  return `${String(name)}_${id}`.replace(/\s+/g, '_').toLowerCase()
}

/** Strips the leading '#' from a legacy target selector. */
export function normalizeTarget(target: string): string {
  return target.trim().replace(/^#/, '')
}

/** Rows and columns a legacy Container actually rendered (NaN or < 1 rendered none). */
export function legacyGrid(inputs: Record<string, unknown>): { rows: number; columns: number } {
  const count = (v: unknown) => {
    const n = parseInt(String(v), 10)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  return { rows: count(inputs.rows), columns: Math.min(count(inputs.columns), 12) }
}
