// The built-in illustrations: our own SVG drawings, shipped with the app (pages load nothing from other sites). The
// engine knows only their names and shapes; the renderer draws them, taking every colour from the theme tokens, so a
// change of accent or scheme recolours them.

export type IllustrationKind = 'banner' | 'spot' | 'divider'

export interface IllustrationInfo {
  /** Stable id stored in models, `<kind>/<name>`. */
  id: string
  kind: IllustrationKind
  /** Display name for the editor gallery. */
  name: string
  /** Default alt text: what the picture shows. Dividers are decorative and have none. */
  alt: string
  /** Width / height. */
  aspect: number
}

export const ILLUSTRATIONS = [
  { id: 'banner/blueprint', kind: 'banner', name: 'Blueprint', alt: 'A drafted part with dimensions on a blueprint grid', aspect: 16 / 5 },
  { id: 'banner/shapes', kind: 'banner', name: 'Shapes', alt: 'Abstract circles, a square and a triangle', aspect: 16 / 5 },
  { id: 'banner/data-dots', kind: 'banner', name: 'Data dots', alt: 'A rising scatter of dots on a dot grid', aspect: 16 / 5 },
  { id: 'spot/data', kind: 'spot', name: 'Data', alt: 'A table beside a bar chart', aspect: 4 / 3 },
  { id: 'spot/map', kind: 'spot', name: 'Map', alt: 'A folded map with a route to a pin', aspect: 4 / 3 },
  { id: 'spot/empty', kind: 'spot', name: 'Empty', alt: 'An empty frame with a card and a plus sign', aspect: 4 / 3 },
  { id: 'divider/wave', kind: 'divider', name: 'Wave', alt: '', aspect: 25 },
  { id: 'divider/dots', kind: 'divider', name: 'Dots', alt: '', aspect: 25 },
  { id: 'divider/ruler', kind: 'divider', name: 'Ruler', alt: '', aspect: 25 },
] as const satisfies readonly IllustrationInfo[]

/**
 * Banner heights as width / height. Banners are drawn as a background that fills any shape and a drawing that always
 * fits whole, so they can be any of these; spots and dividers keep their own shape.
 */
export const BANNER_HEIGHTS = { short: 6, medium: 4, tall: 16 / 5 } as const
export type BannerHeight = keyof typeof BANNER_HEIGHTS

export type IllustrationId = (typeof ILLUSTRATIONS)[number]['id']

export function illustrationInfo(id: string): IllustrationInfo | undefined {
  return ILLUSTRATIONS.find((i) => i.id === id)
}

export function isIllustrationId(id: string): id is IllustrationId {
  return illustrationInfo(id) !== undefined
}
