import type { FeatureDefinition } from '../feature.js'
import { asList, asString, disableInput, nameInput } from '../inputs.js'
import { node } from '../nodes.js'
import { title } from './blocks.js'

/** A card with a heading, a description, a checklist and an emphasized closing line (e.g. plans and prices). */
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
    // Empty entries are left out, so the list's items say which entries they show.
    const entries = asList(inputs.items).flatMap((item, entry) => (item.trim() === '' ? [] : [{ text: item.trim(), entry }]))
    const items = entries.map((e) => e.text)
    const description = asString(inputs.description).trim()
    const highlight = asString(inputs.highlight).trim()
    const children = [
      ...title(ctx, 'heading', asString(inputs.heading), 'heading'),
      ...(description
        ? [
            node(
              'paragraph',
              ctx.nodeId('description'),
              { text: description, emphasis: 'muted' as const },
              { edit: { text: { input: 'description', kind: 'text' } } },
            ),
          ]
        : []),
      ...(items.length > 0
        ? [
            node(
              'list',
              ctx.nodeId('items'),
              { items, align: 'left' as const, marker: 'check' as const },
              { edit: { items: { input: 'items', kind: 'item', entries: entries.map((e) => e.entry) } } },
            ),
          ]
        : []),
      ...(highlight
        ? [
            node(
              'paragraph',
              ctx.nodeId('highlight'),
              { text: highlight, emphasis: 'highlight' as const },
              { edit: { text: { input: 'highlight', kind: 'text' } } },
            ),
          ]
        : []),
    ]
    return { node: node('card', ctx.nodeId(), {}, { children }) }
  },
}
