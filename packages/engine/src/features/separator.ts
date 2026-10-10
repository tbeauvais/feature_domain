import type { FeatureDefinition } from '../feature.js'
import { alignInput, asAlign, asInt, asString, clamp, disableInput, nameInput } from '../inputs.js'
import { parseHex } from '../theme/color.js'
import { node } from '../nodes.js'
import { SEPARATOR_STYLES, type SeparatorStyle } from '../types.js'

/**
 * A horizontal rule between sections, or a divider illustration (wave, dots, ruler). Without a colour a line uses the
 * theme's border colour and a divider the accent.
 */
export const SeparatorFeature: FeatureDefinition = {
  type: 'SeparatorFeature',
  name: 'Separator',
  icon: 'minus',
  placement: 'required',
  inputs: [
    nameInput('Separator'),
    disableInput,
    {
      name: 'style',
      label: 'Style',
      type: 'string',
      default: 'line',
      control: 'text-select',
      options: SEPARATOR_STYLES.map((value) => ({ value, text: value[0]!.toUpperCase() + value.slice(1) })),
    },
    { name: 'color', label: 'Colour', type: 'color', default: '', placeholder: 'theme', control: 'color-picker' },
    { name: 'thickness', label: 'Thickness (px)', type: 'integer', default: 1, min: 1, max: 24, control: 'text-input', showWhen: { input: 'style', equals: 'line' } },
    { name: 'width', label: 'Width (%)', type: 'integer', default: 100, min: 5, max: 100, control: 'text-input' },
    alignInput('center'),
  ],

  generate(inputs, ctx) {
    const color = asString(inputs.color).trim()
    const valid = color === '' || parseHex(color) !== undefined
    if (!valid) ctx.report('warning', `Colour "${color}" is not a hex colour; using the theme's colour`)
    const style: SeparatorStyle = (SEPARATOR_STYLES as readonly unknown[]).includes(inputs.style) ? (inputs.style as SeparatorStyle) : 'line'
    const props = {
      style,
      color: valid ? color : '',
      thickness: clamp(asInt(inputs.thickness, 1), 1, 24),
      width: clamp(asInt(inputs.width, 100), 5, 100),
      align: asAlign(inputs.align, 'center'),
    }
    return { node: node('separator', ctx.nodeId(), props) }
  },
}
