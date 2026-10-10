import type { FeatureDefinition } from '../feature.js'
import { asString, disableInput, nameInput } from '../inputs.js'
import { node } from '../nodes.js'
import { paragraphs, title } from './blocks.js'

/** A title and text with an image beside them (stacked on narrow pages). */
export const ImageWithParagraphFeature: FeatureDefinition = {
  type: 'ImageWithParagraphFeature',
  name: 'Image with text',
  icon: 'image',
  placement: 'required',
  inputs: [
    nameInput('Image with text'),
    disableInput,
    { name: 'title', label: 'Title', type: 'string', default: 'A short title', control: 'text-input' },
    { name: 'text', label: 'Text', type: 'text', default: 'A few sentences about the picture. Leave a blank line to start a new paragraph.', control: 'text-area' },
    { name: 'src', label: 'Image URL', type: 'string', default: '', placeholder: 'https://', control: 'text-input' },
    { name: 'alt', label: 'Alt text', type: 'string', default: '', control: 'text-input' },
    {
      name: 'image_side',
      label: 'Image side',
      type: 'string',
      default: 'left',
      control: 'text-select',
      options: [
        { value: 'left', text: 'Left' },
        { value: 'right', text: 'Right' },
      ],
    },
  ],

  generate(inputs, ctx) {
    const side = inputs.image_side === 'right' ? 'right' : 'left'
    // An empty or unusable image URL renders as a quiet frame (the image node's own behaviour).
    const image = node('image', ctx.nodeId('image'), { src: asString(inputs.src).trim(), alt: asString(inputs.alt), width: '', height: '', responsive: true, align: 'left' })
    const body = node('stack', ctx.nodeId('body'), {}, { children: [...title(ctx, 'title', asString(inputs.title)), ...paragraphs(ctx, 'p', asString(inputs.text))] })
    return { node: node('media', ctx.nodeId(), { side }, { children: [image, body] }) }
  },
}
