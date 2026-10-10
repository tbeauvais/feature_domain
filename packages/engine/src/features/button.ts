import type { FeatureDefinition } from '../feature.js'
import { alignInput, asAlign, asString, disableInput, nameInput, type InputOption } from '../inputs.js'
import { node } from '../nodes.js'
import { BUTTON_SIZES, BUTTON_VARIANTS, type ButtonSize, type ButtonVariant } from '../types.js'

const label = (value: string) => value[0]!.toUpperCase() + value.slice(1)
const options = (values: readonly string[]): InputOption[] => values.map((value) => ({ value, text: label(value) }))

/** A link styled as a button: primary (solid accent), secondary (outline), soft (accent tint) or a plain link. */
export const ButtonFeature: FeatureDefinition = {
  type: 'ButtonFeature',
  name: 'Button',
  icon: 'mouse-pointer-click',
  placement: 'required',
  inputs: [
    nameInput('Button'),
    disableInput,
    { name: 'text', label: 'Text', type: 'string', default: 'Get started', control: 'text-input' },
    { name: 'href', label: 'Link URL', type: 'string', default: 'https://example.com', placeholder: 'https://', control: 'text-input' },
    { name: 'style', label: 'Style', type: 'string', default: 'primary', control: 'text-select', options: options(BUTTON_VARIANTS) },
    { name: 'size', label: 'Size', type: 'string', default: 'medium', control: 'text-select', options: options(BUTTON_SIZES) },
    alignInput('center'),
  ],

  generate(inputs, ctx) {
    const href = asString(inputs.href).trim()
    if (asString(inputs.text).trim() === '') ctx.report('warning', 'The button has no text, so it is invisible')
    if (href !== '' && !/^https?:\/\//i.test(href)) ctx.report('warning', `Link URL "${href}" is not an http(s) address, so the button is shown without it`)
    const variant = (BUTTON_VARIANTS as readonly unknown[]).includes(inputs.style) ? (inputs.style as ButtonVariant) : 'primary'
    const size = (BUTTON_SIZES as readonly unknown[]).includes(inputs.size) ? (inputs.size as ButtonSize) : 'medium'
    const props = { text: asString(inputs.text), href, variant, size, align: asAlign(inputs.align, 'center') }
    return { node: node('button', ctx.nodeId(), props) }
  },
}
