// Colour maths for theme tokens: sRGB hex <-> OKLCH, gamut mapping and WCAG contrast. OKLCH is perceptually uniform,
// so changing lightness keeps the hue and a ramp of lightness steps looks evenly spaced whatever the accent colour.

/** A colour in OKLCH: lightness 0..1, chroma 0..~0.4, hue in degrees. */
export interface Oklch {
  l: number
  c: number
  h: number
}

type Rgb = [number, number, number]

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/** Parses `#rgb` or `#rrggbb`. Returns undefined for anything else. */
export function parseHex(value: string): Rgb | undefined {
  const m = HEX.exec(value.trim())
  if (!m) return undefined
  let hex = m[1]!
  if (hex.length === 3) hex = [...hex].map((ch) => ch + ch).join('')
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const fromLinear = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)

function srgbToOklch([r8, g8, b8]: Rgb): Oklch {
  const [r, g, b] = [toLinear(r8), toLinear(g8), toLinear(b8)]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const h = (Math.atan2(B, A) * 180) / Math.PI
  return { l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h }
}

/** OKLCH to gamma-encoded sRGB components, possibly outside 0..1 (out of gamut). */
function oklchToSrgb({ l: L, c, h }: Oklch): Rgb {
  const A = c * Math.cos((h * Math.PI) / 180)
  const B = c * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

const inGamut = (rgb: Rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4)

export function hexToOklch(hex: string): Oklch | undefined {
  const rgb = parseHex(hex)
  return rgb && srgbToOklch(rgb)
}

/**
 * The nearest displayable sRGB colour as `#rrggbb`. Out-of-gamut colours keep their lightness and hue and lose chroma
 * (binary search), which preserves contrast decisions made on lightness far better than clipping each channel.
 */
export function oklchToHex(color: Oklch): string {
  const l = Math.min(1, Math.max(0, color.l))
  const target = { ...color, l, c: Math.max(0, color.c) }
  let rgb = oklchToSrgb(target)
  if (!inGamut(rgb)) {
    let lo = 0
    let hi = target.c
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(oklchToSrgb({ ...target, c: mid }))) lo = mid
      else hi = mid
    }
    rgb = oklchToSrgb({ ...target, c: lo })
  }
  return toHex(rgb)
}

/** WCAG 2 relative luminance of a hex colour. */
export function luminance(hex: string): number {
  const [r, g, b] = (parseHex(hex) ?? [0, 0, 0]).map(toLinear) as Rgb
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2 contrast ratio between two hex colours (1..21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * `fg` as hex, with its lightness moved (hue and chroma kept where the gamut allows) until it reaches `min` contrast
 * against every background. It moves towards whichever of black or white contrasts more with the backgrounds, which
 * can always reach 4.5:1 against a single background (max(black, white) contrast is at least sqrt(21) ≈ 4.58).
 */
export function ensureContrast(fg: Oklch, backgrounds: string[], min = 4.5): string {
  const worst = (hex: string) => Math.min(...backgrounds.map((bg) => contrast(hex, bg)))
  let hex = oklchToHex(fg)
  if (worst(hex) >= min) return hex
  const darker = Math.min(...backgrounds.map((bg) => contrast('#000000', bg))) >= Math.min(...backgrounds.map((bg) => contrast('#ffffff', bg)))
  for (let step = 1; step <= 100; step++) {
    const l = darker ? fg.l - step * 0.01 : fg.l + step * 0.01
    hex = oklchToHex({ ...fg, l })
    if (worst(hex) >= min || l <= 0 || l >= 1) break
  }
  return hex
}
