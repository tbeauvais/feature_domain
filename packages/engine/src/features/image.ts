import type { FeatureDefinition } from '../feature.js'
import { alignInput, asAlign, asBool, asString, disableInput, nameInput } from '../inputs.js'
import { node } from '../nodes.js'

export const ImageFeature: FeatureDefinition = {
  type: 'ImageFeature',
  name: 'Image',
  icon: 'image',
  placement: 'required',
  inputs: [
    nameInput(),
    disableInput,
    { name: 'src', label: 'Image URL', type: 'string', default: '', placeholder: 'https://', control: 'text-input' },
    { name: 'responsive', label: 'Responsive', type: 'boolean', default: false, control: 'checkbox-input' },
    { name: 'alt', label: 'Alt Text', type: 'string', default: '', control: 'text-input' },
    { name: 'height', label: 'Height', type: 'string', default: '200', control: 'text-input' },
    { name: 'width', label: 'Width', type: 'string', default: '300', control: 'text-input' },
    alignInput('center'),
  ],

  generate(inputs, ctx) {
    const props = {
      src: asString(inputs.src),
      alt: asString(inputs.alt),
      width: asString(inputs.width),
      height: asString(inputs.height),
      responsive: asBool(inputs.responsive),
      align: asAlign(inputs.align, 'center'),
    }
    return { node: node('image', ctx.nodeId(), props) }
  },
}
