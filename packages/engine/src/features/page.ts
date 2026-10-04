import type { FeatureDefinition } from '../feature'
import { node } from '../ids'
import { asString, nameInput, pageLocationInput } from '../inputs'

export const PAGE_CONTAINER = 'page_container'

export const PageFeature: FeatureDefinition = {
  type: 'PageFeature',
  name: 'Page',
  icon: 'file',
  inputs: [
    nameInput('Page'),
    { name: 'border_color', label: 'Border Color', type: 'color', control: 'color-picker' },
    { name: 'background_color', label: 'Background Color', type: 'color', control: 'color-picker' },
    { name: 'background_image', label: 'Background Image', type: 'string', control: 'text-input' },
    pageLocationInput,
  ],

  // Legacy models place top-level features into a fixed "#page_container" target.
  slots: () => [PAGE_CONTAINER],

  generate(inputs) {
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

    return node(PAGE_CONTAINER, 'page', {}, [], style)
  },
}
