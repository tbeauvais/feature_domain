import type { FeatureDefinition } from '../feature.js'
import { alignInput, asAlign, asList, disableInput, nameInput } from '../inputs.js'
import { node } from '../nodes.js'

export const ListFeature: FeatureDefinition = {
  type: 'ListFeature',
  name: 'List',
  icon: 'list',
  placement: 'required',
  inputs: [
    nameInput(),
    disableInput,
    { name: 'items', label: 'List Items', type: 'list', default: ['Red', 'Green', 'Blue'], control: 'list-input' },
    alignInput('center'),
  ],

  generate(inputs, ctx) {
    return { node: node('list', ctx.nodeId(), { items: asList(inputs.items), align: asAlign(inputs.align, 'center') }) }
  },
}
