import type { FeatureDefinition } from '../feature.js'
import { asString, disableInput, nameInput } from '../inputs.js'
import { node } from '../nodes.js'

/** A text link that opens in a new tab. */
export const LinkFeature: FeatureDefinition = {
  type: 'LinkFeature',
  name: 'Link',
  icon: 'link',
  placement: 'required',
  inputs: [
    nameInput('Link'),
    disableInput,
    { name: 'text', label: 'Text', type: 'string', default: 'Learn more', control: 'text-input' },
    { name: 'href', label: 'Link URL', type: 'string', default: 'https://example.com', placeholder: 'https://', control: 'text-input' },
  ],

  generate(inputs, ctx) {
    const href = asString(inputs.href).trim()
    if (href !== '' && !/^https?:\/\//i.test(href)) ctx.report('warning', `Link URL "${href}" is not an http(s) address, so the link is shown without it`)
    return { node: node('link', ctx.nodeId(), { text: asString(inputs.text), href }) }
  },
}
