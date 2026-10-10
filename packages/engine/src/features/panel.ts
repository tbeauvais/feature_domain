import type { FeatureDefinition } from '../feature.js'
import { asOneOf, asString, capitalisedOptions, disableInput, nameInput } from '../inputs.js'
import { node } from '../nodes.js'
import { PANEL_EMPHASES, type NodeKinds } from '../types.js'

export const PanelFeature: FeatureDefinition = {
  type: 'PanelFeature',
  name: 'Panel',
  icon: 'panel-top',
  placement: 'required',
  inputs: [
    nameInput(),
    disableInput,
    { name: 'heading', label: 'Heading', type: 'string', default: 'Details', control: 'text-input' },
    { name: 'emphasis', label: 'Emphasis', type: 'string', default: 'normal', control: 'segmented', options: capitalisedOptions(PANEL_EMPHASES) },
  ],

  slots: () => ['body'],

  generate(inputs, ctx) {
    const body = node('panel-body', ctx.nodeId('body'), {}, { slot: 'body' })
    const props: NodeKinds['panel'] = { heading: asString(inputs.heading) }
    const emphasis = asOneOf(inputs.emphasis, PANEL_EMPHASES, 'normal')
    if (emphasis !== 'normal') props.emphasis = emphasis
    return { node: node('panel', ctx.nodeId(), props, { children: [body] }) }
  },
}
