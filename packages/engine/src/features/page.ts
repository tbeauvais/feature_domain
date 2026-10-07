import type { FeatureDefinition } from '../feature.js'
import { asString, nameInput } from '../inputs.js'
import { node } from '../nodes.js'

export const PageFeature: FeatureDefinition = {
  type: 'PageFeature',
  name: 'Page',
  icon: 'file',
  placement: 'required',
  inputs: [
    nameInput('Page'),
    { name: 'background_image', label: 'Background Image', type: 'string', default: '', control: 'text-input' },
  ],

  slots: () => ['content'],

  generate(inputs, ctx) {
    // Colours come from the theme (legacy border_color / background_color inputs are dropped by the migration and
    // ignored if still stored). A background image is content, so it stays.
    const style: Record<string, string> = {}
    const image = asString(inputs.background_image)
    if (image) style.backgroundImage = `url(${JSON.stringify(image)})`

    return { node: node('page', ctx.nodeId(), {}, { slot: 'content', style }) }
  },
}
