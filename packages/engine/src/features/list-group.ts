import type { FeatureDefinition } from '../feature.js'
import { asList, asString, disableInput, nameInput } from '../inputs.js'
import { node } from '../nodes.js'
import { title } from './blocks.js'

/** A card with a heading, a description, a checklist and an emphasised closing line (e.g. plans and prices). */
export const ListGroupFeature: FeatureDefinition = {
  type: 'ListGroupFeature',
  name: 'List card',
  icon: 'list-checks',
  placement: 'required',
  inputs: [
    nameInput('List card'),
    disableInput,
    { name: 'heading', label: 'Heading', type: 'string', default: 'Starter', control: 'text-input' },
    { name: 'description', label: 'Description', type: 'text', default: 'Everything you need to get going.', control: 'text-area' },
    { name: 'items', label: 'Items', type: 'list', default: ['Email support', '1 TB storage', '2 GB memory'], control: 'list-input' },
    { name: 'highlight', label: 'Highlight', type: 'string', default: '$25 / month', placeholder: 'e.g. a price', control: 'text-input' },
  ],

  generate(inputs, ctx) {
    const items = asList(inputs.items).map((item) => item.trim()).filter((item) => item !== '')
    const description = asString(inputs.description).trim()
    const highlight = asString(inputs.highlight).trim()
    const children = [
      ...title(ctx, 'heading', asString(inputs.heading)),
      ...(description ? [node('paragraph', ctx.nodeId('description'), { text: description, emphasis: 'muted' as const })] : []),
      ...(items.length > 0 ? [node('list', ctx.nodeId('items'), { items, align: 'left' as const, marker: 'check' as const })] : []),
      ...(highlight ? [node('paragraph', ctx.nodeId('highlight'), { text: highlight, emphasis: 'highlight' as const })] : []),
    ]
    return { node: node('card', ctx.nodeId(), {}, { children }) }
  },
}
