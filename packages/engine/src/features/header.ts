import type { FeatureDefinition } from '../feature'
import { node } from '../ids'
import { alignInput, asInt, asString, clamp, disableInput, nameInput, pageLocationInput } from '../inputs'
import { normalizeAlign, normalizeTone, toneOptions } from './legacy'

export const HeaderFeature: FeatureDefinition = {
  type: 'HeaderFeature',
  name: 'Header',
  icon: 'heading',
  inputs: [
    nameInput(),
    disableInput,
    {
      name: 'text_style',
      label: 'Text Style',
      type: 'string',
      default: 'info',
      control: 'text-select',
      options: toneOptions(true),
    },
    {
      name: 'background',
      label: 'Background Style',
      type: 'string',
      default: '',
      control: 'text-select',
      options: toneOptions(true).filter((o) => o.value !== 'muted'),
    },
    { name: 'text', label: 'Text', type: 'string', default: 'Enter your header text here', control: 'text-input' },
    alignInput('center'),
    { name: 'size', label: 'Size', type: 'integer', default: 1, min: 1, max: 6, control: 'text-input' },
    pageLocationInput,
  ],

  generate(inputs, ctx) {
    return node(ctx.domId, 'heading', {
      text: asString(inputs.text),
      level: clamp(asInt(inputs.size, 1), 1, 6),
      align: normalizeAlign(inputs.align, 'left'),
      tone: normalizeTone(inputs.text_style),
      background: normalizeTone(inputs.background),
    })
  },
}
