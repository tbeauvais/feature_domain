import type { FeatureDefinition } from '../feature.js'
import { alignInput, asAlign, asString, disableInput, nameInput } from '../inputs.js'
import { node } from '../nodes.js'

/** The words of the Account's sign-in button when its input is empty. */
export const DEFAULT_SIGN_IN_TEXT = 'Sign in'

/**
 * The visitor's account on a published app with sign-in: a Sign in button (to the app's sign-in page) for someone
 * signed out; for someone signed in, who they are, Sign out, and their account's download and deletion. Interactive,
 * so a node kind of its own (`account`). In the builder (never signed in) it shows the signed-out look.
 */
export const AccountFeature: FeatureDefinition = {
  type: 'AccountFeature',
  name: 'Account',
  icon: 'user',
  placement: 'required',
  inputs: [
    nameInput('Account'),
    disableInput,
    { name: 'sign_in_text', label: 'Sign-in button', type: 'string', default: DEFAULT_SIGN_IN_TEXT, control: 'text-input' },
    alignInput('right'),
  ],

  generate(inputs, ctx) {
    const signInText = asString(inputs.sign_in_text).trim() || DEFAULT_SIGN_IN_TEXT
    // Typed text the canvas can edit in place (an empty input shows the default words, which aren't the input's).
    const edit = signInText === asString(inputs.sign_in_text) ? { signInText: { input: 'sign_in_text', kind: 'text' as const } } : undefined
    return { node: node('account', ctx.nodeId(), { signInText, align: asAlign(inputs.align, 'right') }, { edit }) }
  },
}
