import type { FeatureDefinition } from '../feature.js'
import { alignInput, asAlign, asInt, asString, asTone, clamp, disableInput, nameInput, toneOptions } from '../inputs.js'
import { node } from '../nodes.js'
import { TONES } from '../types.js'

export const HeaderFeature: FeatureDefinition = {
  type: 'HeaderFeature',
  name: 'Header',
  icon: 'heading',
  placement: 'required',
  inputs: [
    nameInput(),
    disableInput,
    { name: 'text_style', label: 'Text Style', type: 'string', default: 'info', control: 'text-select', options: toneOptions(TONES, true) },
    {
      name: 'background',
      label: 'Background Style',
      type: 'string',
      default: '',
      control: 'text-select',
      options: toneOptions(TONES.filter((t) => t !== 'muted'), true),
    },
    { name: 'text', label: 'Text', type: 'string', default: 'Enter your header text here', control: 'text-input' },
    alignInput('center'),
    { name: 'size', label: 'Size', type: 'integer', default: 1, min: 1, max: 6, control: 'text-input' },
  ],

  generate(inputs, ctx) {
    const props = {
      text: asString(inputs.text),
      level: clamp(asInt(inputs.size, 1), 1, 6),
      align: asAlign(inputs.align, 'center'),
      tone: asTone(inputs.text_style),
      background: asTone(inputs.background),
    }
    return { node: node('heading', ctx.nodeId(), props) }
  },
}
