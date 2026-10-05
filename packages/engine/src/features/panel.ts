import type { FeatureDefinition } from '../feature.js'
import { asString, asTone, disableInput, nameInput, toneOptions } from '../inputs.js'
import { node } from '../nodes.js'
import { TONES } from '../types.js'

export const PanelFeature: FeatureDefinition = {
  type: 'PanelFeature',
  name: 'Panel',
  icon: 'panel-top',
  placement: 'required',
  inputs: [
    nameInput(),
    disableInput,
    {
      name: 'style',
      label: 'Style',
      type: 'string',
      default: 'primary',
      control: 'text-select',
      options: toneOptions(TONES.filter((t) => t !== 'muted'), true),
    },
    { name: 'heading', label: 'Heading', type: 'string', default: 'Panel heading', control: 'text-input' },
  ],

  slots: () => ['body'],

  generate(inputs, ctx) {
    const body = node('panel-body', ctx.nodeId('body'), {}, { slot: 'body' })
    const props = { heading: asString(inputs.heading), tone: asTone(inputs.style) }
    return { node: node('panel', ctx.nodeId(), props, { children: [body] }) }
  },
}
