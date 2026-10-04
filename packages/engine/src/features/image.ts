import type { FeatureDefinition } from '../feature'
import { node } from '../ids'
import { alignInput, asBool, asString, disableInput, nameInput, pageLocationInput } from '../inputs'
import { normalizeAlign } from './legacy'

export const ImageFeature: FeatureDefinition = {
  type: 'ImageFeature',
  name: 'Image',
  icon: 'image',
  inputs: [
    nameInput(),
    disableInput,
    { name: 'src', label: 'Image URL', type: 'string', default: '', placeholder: 'https://', control: 'text-input' },
    { name: 'responsive', label: 'Responsive', type: 'boolean', default: false, control: 'checkbox-input' },
    { name: 'alt', label: 'Alt Text', type: 'string', default: '', control: 'text-input' },
    { name: 'height', label: 'Height', type: 'string', default: '200', control: 'text-input' },
    { name: 'width', label: 'Width', type: 'string', default: '300', control: 'text-input' },
    alignInput('center'),
    pageLocationInput,
  ],

  generate(inputs, ctx) {
    return node(ctx.domId, 'image', {
      src: asString(inputs.src),
      alt: asString(inputs.alt),
      width: asString(inputs.width),
      height: asString(inputs.height),
      responsive: asBool(inputs.responsive),
      align: normalizeAlign(inputs.align, 'left'),
    })
  },
}
