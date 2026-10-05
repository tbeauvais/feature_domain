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
    { name: 'border_color', label: 'Border Color', type: 'color', default: '', control: 'color-picker' },
    { name: 'background_color', label: 'Background Color', type: 'color', default: '', control: 'color-picker' },
    { name: 'background_image', label: 'Background Image', type: 'string', default: '', control: 'text-input' },
  ],

  slots: () => ['content'],

  generate(inputs, ctx) {
    const style: Record<string, string> = {}
    const border = asString(inputs.border_color)
    if (border) {
      style.border = `5px solid ${border}`
      style.borderRadius = '5px'
      style.padding = '8px'
    }
    const background = asString(inputs.background_color)
    if (background) style.backgroundColor = background
    const image = asString(inputs.background_image)
    if (image) style.backgroundImage = `url(${JSON.stringify(image)})`

    return { node: node('page', ctx.nodeId(), {}, { slot: 'content', style }) }
  },
}
