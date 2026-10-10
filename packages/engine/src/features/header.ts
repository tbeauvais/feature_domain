import type { FeatureDefinition } from '../feature.js'
import { alignInput, asAlign, asInt, asOneOf, asString, capitalisedOptions, clamp, disableInput, nameInput } from '../inputs.js'
import { node } from '../nodes.js'
import { HEADING_BACKGROUNDS, HEADING_COLOURS, type NodeKinds } from '../types.js'

export const HeaderFeature: FeatureDefinition = {
  type: 'HeaderFeature',
  name: 'Header',
  icon: 'heading',
  placement: 'required',
  inputs: [
    nameInput(),
    disableInput,
    { name: 'text', label: 'Text', type: 'string', default: 'Your headline goes here', control: 'text-input' },
    { name: 'colour', label: 'Colour', type: 'string', default: 'ink', control: 'segmented', options: capitalisedOptions(HEADING_COLOURS) },
    { name: 'background', label: 'Background', type: 'string', default: 'none', control: 'segmented', options: capitalisedOptions(HEADING_BACKGROUNDS) },
    alignInput('center'),
    { name: 'size', label: 'Size', type: 'integer', default: 1, min: 1, max: 6, control: 'text-input' },
  ],

  generate(inputs, ctx) {
    const colour = asOneOf(inputs.colour, HEADING_COLOURS, 'ink')
    const background = asOneOf(inputs.background, HEADING_BACKGROUNDS, 'none')
    const props: NodeKinds['heading'] = { text: asString(inputs.text), level: clamp(asInt(inputs.size, 1), 1, 6), align: asAlign(inputs.align, 'center') }
    if (colour !== 'ink') props.colour = colour
    if (background !== 'none') props.background = background
    return { node: node('heading', ctx.nodeId(), props) }
  },
}
