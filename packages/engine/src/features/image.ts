import type { FeatureDefinition } from '../feature.js'
import { BANNER_HEIGHTS, ILLUSTRATIONS, illustrationInfo, type BannerHeight } from '../illustrations.js'
import { alignInput, asAlign, asBool, asString, disableInput, nameInput } from '../inputs.js'
import { node } from '../nodes.js'

const PICTURES = ILLUSTRATIONS.filter((i) => i.kind !== 'divider')
const BANNERS = ILLUSTRATIONS.filter((i) => i.kind === 'banner').map((i) => i.id)

/**
 * A picture: one of our built-in illustrations (in the theme's colours) or an image at an address. Stored images without
 * a Source are links, as they were before illustrations existed; new ones start as an illustration.
 */
export const ImageFeature: FeatureDefinition = {
  type: 'ImageFeature',
  name: 'Image',
  icon: 'image',
  placement: 'required',
  inputs: [
    nameInput(),
    disableInput,
    {
      name: 'source',
      label: 'Source',
      type: 'string',
      default: 'link',
      initial: 'illustration',
      control: 'segmented',
      options: [
        { value: 'illustration', text: 'Illustration' },
        { value: 'link', text: 'Link' },
      ],
    },
    {
      name: 'illustration',
      label: 'Illustration',
      type: 'string',
      default: 'banner/blueprint',
      control: 'illustration-gallery',
      options: PICTURES.map((i) => ({ value: i.id, text: i.name })),
      showWhen: { input: 'source', equals: 'illustration' },
    },
    {
      name: 'banner_height',
      label: 'Height',
      type: 'string',
      default: 'medium',
      control: 'segmented',
      options: [
        { value: 'short', text: 'Short' },
        { value: 'medium', text: 'Medium' },
        { value: 'tall', text: 'Tall' },
      ],
      showWhen: [
        { input: 'source', equals: 'illustration' },
        { input: 'illustration', equals: BANNERS },
      ],
    },
    { name: 'src', label: 'Image URL', type: 'string', default: '', placeholder: 'https://', control: 'text-input', showWhen: { input: 'source', equals: 'link' } },
    { name: 'alt', label: 'Alt Text', type: 'string', default: '', control: 'text-input' },
    { name: 'decorative', label: 'Decorative (screen readers skip it)', type: 'boolean', default: false, control: 'checkbox-input', showWhen: { input: 'source', equals: 'illustration' } },
    { name: 'responsive', label: 'Responsive', type: 'boolean', default: false, initial: true, control: 'checkbox-input' },
    { name: 'height', label: 'Height', type: 'string', default: '200', control: 'text-input', showWhen: { input: 'source', equals: 'link' } },
    { name: 'width', label: 'Width', type: 'string', default: '300', control: 'text-input' },
    alignInput('center'),
  ],

  generate(inputs, ctx) {
    const align = asAlign(inputs.align, 'center')
    const responsive = asBool(inputs.responsive)
    if (inputs.source === 'illustration') {
      const name = asString(inputs.illustration)
      const info = illustrationInfo(name)
      if (!info || info.kind === 'divider') ctx.report('warning', name === '' ? 'No illustration chosen' : `Unknown illustration "${name}"`)
      // Alt text describes the picture unless the user wrote their own; a decorative one has none.
      const alt = asBool(inputs.decorative) ? '' : asString(inputs.alt).trim() || (info?.alt ?? '')
      // Responsive illustrations fill the width; otherwise the width input sets it and the height follows the shape.
      const props: { name: string; alt: string; width: string; align: typeof align; aspect?: number } = { name, alt, width: responsive ? '' : asString(inputs.width), align }
      // Banners can be short, medium or tall; the height follows the width, so it suits every screen size.
      if (info?.kind === 'banner') props.aspect = BANNER_HEIGHTS[inputs.banner_height as BannerHeight] ?? BANNER_HEIGHTS.medium
      return { node: node('illustration', ctx.nodeId(), props) }
    }
    const props = {
      src: asString(inputs.src),
      alt: asString(inputs.alt),
      width: asString(inputs.width),
      height: asString(inputs.height),
      responsive,
      align,
    }
    return { node: node('image', ctx.nodeId(), props) }
  },
}
