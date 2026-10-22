import type { FeatureDefinition } from '../feature.js'
import { asString, disableInput, heightInput, nameInput } from '../inputs.js'
import { node } from '../nodes.js'
import { aspectOf, aspectScale, readHeight } from '../sizes.js'
import type { DocNode } from '../types.js'
import { title } from './blocks.js'

/**
 * Map heights as width / height (the legacy map was 400 × 200, medium). The drawing is a banner, a background that
 * fills any shape under a pin that always shows whole, so it suits each.
 */
export const MAP_HEIGHTS = { short: 3, medium: 2, tall: 4 / 3 } as const
/** Map heights as a % of the width: the names, or any whole % from 20 to 100. */
export const MAP_HEIGHT_SCALE = aspectScale(MAP_HEIGHTS, 20, 100)

/** Where "Open in Google Maps" goes: a search for the address, in Google's documented Maps URL form (no key, nothing loaded until it is followed). */
export function googleMapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

/**
 * A place on a map (legacy GoogleMap, same type id, whose keyless Google Static Maps image no longer loads): a card
 * with a title, our own street-map drawing, the address and a link that opens it in Google Maps. The page loads
 * nothing from other sites. A live map (Google's Maps Embed API, with a key kept as a site setting) is planned after the Worker.
 */
export const MapFeature: FeatureDefinition = {
  type: 'GoogleMapFeature',
  name: 'Map',
  icon: 'map',
  placement: 'required',
  inputs: [
    nameInput('Map'),
    disableInput,
    { name: 'title', label: 'Title', type: 'string', default: '', initial: 'Find us', control: 'text-input' },
    // The legacy default, which stored maps without an address showed.
    { name: 'address', label: 'Address', type: 'string', default: '131 Willow Rd. Guilford, CT', control: 'text-input' },
    heightInput('height', MAP_HEIGHT_SCALE),
  ],

  generate(inputs, ctx) {
    const address = asString(inputs.address).trim()
    const height = readHeight(inputs.height, MAP_HEIGHT_SCALE)
    if (!height) ctx.report('warning', `Height "${asString(inputs.height)}" should be short, medium, tall or a % of the width; using medium`)
    const children: DocNode[] = [
      ...title(ctx, 'title', asString(inputs.title), 'title'),
      // Decorative: the same drawing for every address, so the address below says where.
      node('illustration', ctx.nodeId('map'), {
        name: 'banner/map',
        alt: '',
        width: '',
        align: 'center',
        aspect: aspectOf(height?.value ?? MAP_HEIGHT_SCALE.named.medium),
      }),
    ]
    if (address) {
      children.push(node('paragraph', ctx.nodeId('address'), { text: address }, { edit: { text: { input: 'address', kind: 'text' } } }))
      // Named with the address, so a page with several maps doesn't have several links all called the same.
      children.push(
        node('link', ctx.nodeId('link'), { text: 'Open in Google Maps', href: googleMapsUrl(address), ariaLabel: `Open ${address} in Google Maps` }),
      )
    } else ctx.report('warning', 'No address: the map has nothing to show or link to')
    return { node: node('card', ctx.nodeId(), {}, { children }) }
  },
}
