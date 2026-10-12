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
    const items = asList(inputs.items)
    const edit = { items: { input: 'items', kind: 'item' as const, entries: items.map((_, i) => i) } }
    return { node: node('list', ctx.nodeId(), { items, align: asAlign(inputs.align, 'center') }, { edit }) }
  },
}
