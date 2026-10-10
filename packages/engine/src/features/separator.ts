import type { FeatureDefinition } from '../feature.js'
import { alignInput, asAlign, asInt, asString, clamp, disableInput, nameInput } from '../inputs.js'
import { parseHex } from '../theme/color.js'
import { node } from '../nodes.js'

/** A horizontal rule between sections. Without a colour it uses the theme's border colour. */
export const SeparatorFeature: FeatureDefinition = {
  type: 'SeparatorFeature',
  name: 'Separator',
  icon: 'minus',
  placement: 'required',
  inputs: [
    nameInput('Separator'),
    disableInput,
    { name: 'color', label: 'Colour', type: 'color', default: '', placeholder: 'theme', control: 'color-picker' },
    { name: 'thickness', label: 'Thickness (px)', type: 'integer', default: 1, min: 1, max: 24, control: 'text-input' },
    { name: 'width', label: 'Width (%)', type: 'integer', default: 100, min: 5, max: 100, control: 'text-input' },
    alignInput('center'),
  ],

  generate(inputs, ctx) {
    const color = asString(inputs.color).trim()
    const valid = color === '' || parseHex(color) !== undefined
    if (!valid) ctx.report('warning', `Colour "${color}" is not a hex colour; using the theme's colour`)
    const props = {
      color: valid ? color : '',
      thickness: clamp(asInt(inputs.thickness, 1), 1, 24),
      width: clamp(asInt(inputs.width, 100), 5, 100),
      align: asAlign(inputs.align, 'center'),
    }
    return { node: node('separator', ctx.nodeId(), props) }
  },
}
