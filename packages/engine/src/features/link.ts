import type { FeatureDefinition } from '../feature.js'
import { asString, disableInput, nameInput } from '../inputs.js'
import { isLinkAddress } from '../links.js'
import { node } from '../nodes.js'

/** A text link: an http(s) address opens in a new tab, a path on this site ("/models/7") in the same one. */
export const LinkFeature: FeatureDefinition = {
  type: 'LinkFeature',
  name: 'Link',
  icon: 'link',
  placement: 'required',
  inputs: [
    nameInput('Link'),
    disableInput,
    { name: 'text', label: 'Text', type: 'string', default: 'Learn more', control: 'text-input' },
    {
      name: 'href',
      label: 'Link URL',
      type: 'string',
      default: 'https://example.com',
      placeholder: 'https://',
      control: 'text-input',
      hint: 'An https:// address, or a path on this site such as /models/7',
    },
  ],

  generate(inputs, ctx) {
    const href = asString(inputs.href).trim()
    if (asString(inputs.text).trim() === '') ctx.report('warning', 'The link has no text, so it is invisible')
    if (href !== '' && !isLinkAddress(href))
      ctx.report('warning', `Link URL "${href}" is not an http(s) address or a path on this site, so the link is shown without it`)
    return { node: node('link', ctx.nodeId(), { text: asString(inputs.text), href }, { edit: { text: { input: 'text', kind: 'text' } } }) }
  },
}
