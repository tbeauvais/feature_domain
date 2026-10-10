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
      default: 'Say what this part of the page is about in a sentence or two.',
      control: 'text-input',
    },
  ],

  generate(inputs, ctx) {
    return { node: node('text', ctx.nodeId(), { text: asString(inputs.text) }) }
  },
}
