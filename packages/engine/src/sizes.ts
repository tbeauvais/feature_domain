import { asString } from './inputs.js'

// Sizes a feature can take by name (short, medium, tall) or as a number in between. Names stay what stored models
// hold; a number is stored with its unit ("28%", "260px"), so one string input carries either.

export const NAMED_HEIGHTS = ['short', 'medium', 'tall'] as const
export type NamedHeight = (typeof NAMED_HEIGHTS)[number]

/**
 * A height scale: what each name means, the unit numbers are in (`%` of the width, so the shape suits every screen;
 * `px` for a fixed height), and the range and step numbers snap to.
 */
export interface HeightScale {
  named: Readonly<Record<NamedHeight, number>>
  unit: '%' | 'px'
  min: number
  max: number
  step: number
}

/** A height as read from a stored value: its number in the scale's unit, and its name when it is a named one. */
export interface Height {
  value: number
  name?: NamedHeight
}

/** Heights given as width / height ratios (banners, maps), as a scale in % of the width. */
export function aspectScale(aspects: Readonly<Record<NamedHeight, number>>, min: number, max: number): HeightScale {
  const named = {} as Record<NamedHeight, number>
  for (const name of NAMED_HEIGHTS) named[name] = 100 / aspects[name]
  return { named, unit: '%', min, max, step: 1 }
}

const NUMBER = /^(\d+(?:\.\d+)?)\s*(%|px)?$/i

/**
 * A stored height: a name, or a number in the scale's unit (the unit may be left out; another unit is invalid), rounded
 * to the step and kept in range. Undefined when it is neither, so the caller can fall back and say so.
 */
export function readHeight(value: unknown, scale: HeightScale): Height | undefined {
  const text = asString(value).trim().toLowerCase()
  if ((NAMED_HEIGHTS as readonly string[]).includes(text)) return { value: scale.named[text as NamedHeight], name: text as NamedHeight }
  const match = NUMBER.exec(text)
  if (!match || (match[2] !== undefined && match[2] !== scale.unit)) return undefined
  return { value: snapHeight(Number(match[1]), scale) }
}

/** A number rounded to the scale's step and kept in its range. */
export function snapHeight(value: number, scale: HeightScale): number {
  const stepped = Math.round(value / scale.step) * scale.step
  return Math.min(scale.max, Math.max(scale.min, stepped))
}

/** A height as stored: a name when it is one, else the number with its unit ("28%", "260px"). */
export function formatHeight(height: Height, scale: HeightScale): string {
  return height.name ?? `${snapHeight(height.value, scale)}${scale.unit}`
}

/** The height in words, as the editor shows it: "Medium", "28%", "260 px". */
export function heightText(height: Height, scale: HeightScale): string {
  if (height.name) return height.name[0]!.toUpperCase() + height.name.slice(1)
  const value = snapHeight(height.value, scale)
  return scale.unit === '%' ? `${value}%` : `${value} px`
}

/** The ratio width / height a height in % of the width gives (an illustration's `aspect`). */
export const aspectOf = (percent: number) => 100 / percent

// Sizes in whole pixels, some with a "no limit" value: a Container's Max width and Min height, a page's content width.

/** A width: pixels, or `full` (no limit). */
export type Width = number | 'full'

/** Whole pixels from `min` to `max` in steps of `step`; with `full`, also no limit (`full` or `none`). */
export interface PixelScale {
  min: number
  max: number
  step: number
  full?: boolean
}

/** Container min heights: from a strip to several screens. */
export const MIN_HEIGHT_SCALE: PixelScale = { min: 40, max: 2000, step: 10 }
/** Container max widths: from a narrow card to the widest content, or filling the page. */
export const MAX_WIDTH_SCALE: PixelScale = { min: 240, max: 1600, step: 10, full: true }
/** Page content widths: how wide the content of a page gets, or the whole page. */
export const CONTENT_WIDTH_SCALE: PixelScale = { min: 480, max: 1600, step: 10, full: true }
/** The content width pages had before it could be set, and the theme default. */
export const DEFAULT_CONTENT_WIDTH = 1120

/** Named content widths the inspector offers. */
export const CONTENT_WIDTH_PRESETS: readonly { name: string; width: Width }[] = [
  { name: 'Narrow', width: 720 },
  { name: 'Standard', width: 960 },
  { name: 'Wide', width: 1120 },
  { name: 'Full', width: 'full' },
]

/**
 * A stored size: whole pixels ("960", "960px") kept in range, or `full` (also `none`) when the scale has no limit;
 * undefined for anything else.
 */
export function readWidth(value: unknown, scale: PixelScale): Width | undefined {
  const text = asString(value).trim().toLowerCase()
  if (text === 'full' || text === 'none') return scale.full ? 'full' : undefined
  const match = /^(\d+)\s*(px)?$/.exec(text)
  if (!match) return undefined
  return Math.min(scale.max, Math.max(scale.min, Number(match[1])))
}

/** A width snapped to the scale's step and range. */
export const snapWidth = (px: number, scale: PixelScale) => Math.min(scale.max, Math.max(scale.min, Math.round(px / scale.step) * scale.step))

/** A width as stored: "full" or whole pixels. */
export const formatWidth = (width: Width) => (width === 'full' ? 'full' : String(width))

/** A width in words: "Full", "960 px". */
export const widthText = (width: Width) => (width === 'full' ? 'Full' : `${width} px`)

/** A width as a CSS length: `100%` for full. */
export const widthCss = (width: Width) => (width === 'full' ? '100%' : `${width}px`)
