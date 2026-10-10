import type { FeatureDefinition } from '../feature.js'
import { asString, disableInput, nameInput } from '../inputs.js'
import { node } from '../nodes.js'
import { paragraphs, title } from './blocks.js'

/** A title over a block of text. Blank lines in the text start new paragraphs. */
export const TextWithParagraphFeature: FeatureDefinition = {
  type: 'TextWithParagraphFeature',
  name: 'Text with title',
  icon: 'align-left',
  placement: 'required',
  inputs: [
    nameInput('Text with title'),
    disableInput,
    { name: 'title', label: 'Title', type: 'string', default: 'A short title', control: 'text-input' },
    { name: 'text', label: 'Text', type: 'text', default: 'A few sentences about this section. Leave a blank line to start a new paragraph.', control: 'text-area' },
  ],

  generate(inputs, ctx) {
    const children = [...title(ctx, 'title', asString(inputs.title)), ...paragraphs(ctx, 'p', asString(inputs.text))]
    return { node: node('stack', ctx.nodeId(), {}, { children }) }
  },
}
