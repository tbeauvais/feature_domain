import type { FeatureDefinition } from '../feature'
import { node } from '../ids'
import { asString, disableInput, nameInput, pageLocationInput } from '../inputs'

export const TextFeature: FeatureDefinition = {
  type: 'TextFeature',
  name: 'Text',
  icon: 'pencil',
  inputs: [
    nameInput(),
    disableInput,
    {
      name: 'text',
      label: 'Text',
      type: 'string',
      default: 'Lorem ipsum dolor sit amet, consectetur adipisicing elit',
      control: 'text-input',
    },
    pageLocationInput,
  ],

  generate(inputs, ctx) {
    return node(ctx.domId, 'text', { text: asString(inputs.text) })
  },
}
