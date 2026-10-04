import type { FeatureDefinition } from '../feature.js'
import { asString, disableInput, nameInput } from '../inputs.js'
import { node } from '../nodes.js'

export const TextFeature: FeatureDefinition = {
  type: 'TextFeature',
  name: 'Text',
  icon: 'pencil',
  placement: 'required',
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
  ],

  generate(inputs, ctx) {
    return { node: node('text', ctx.nodeId(), { text: asString(inputs.text) }) }
  },
}
