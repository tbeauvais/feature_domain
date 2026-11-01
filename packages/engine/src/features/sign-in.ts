import type { FeatureDefinition } from '../feature.js'
import type { GenerateResult } from '../generate.js'
import { asBool, asList, asString, disableInput, nameInput, type InputDef } from '../inputs.js'

export const SIGN_IN_FEATURE = 'SignInFeature'

/** Who can open a published app: anyone, people signed in, or only the listed emails and domains (signed in). */
export const OPEN_TO = ['anyone', 'signed-in', 'listed'] as const
export type OpenTo = (typeof OPEN_TO)[number]

/** What an app's Sign-in says, as the Worker enforces it. */
export interface SignInSettings {
  openTo: OpenTo
  /** The emails and `@domains` that may sign in (lowercase), or null for anyone. */
  allowed: readonly string[] | null
  /** Whether people without an account may make one by signing in. */
  signUp: boolean
}

export interface SignInExports {
  signIn: SignInSettings
}

export function isSignInExports(value: unknown): value is SignInExports {
  const s = (value as Partial<SignInExports> | undefined)?.signIn
  return typeof s === 'object' && s !== null && OPEN_TO.includes(s.openTo) && typeof s.signUp === 'boolean' && (s.allowed === null || Array.isArray(s.allowed))
}

/** The longest list of emails and domains (one per line). */
export const MAX_ALLOWED_ENTRIES = 500

/** An email (`ann@example.com`) or a whole domain (`@example.com`), lowercase; undefined when it is neither. */
export function readAllowedEntry(entry: string): string | undefined {
  const e = entry.trim().toLowerCase()
  return /^[^\s@]*@[^\s@.]+(\.[^\s@.]+)+$/.test(e) && !e.includes('..') ? e : undefined
}

const openToInput: InputDef = {
  name: 'open_to',
  label: 'Who can open the app',
  type: 'string',
  default: 'anyone',
  control: 'segmented',
  options: [
    { value: 'anyone', text: 'Anyone' },
    { value: 'signed-in', text: 'Signed in' },
    { value: 'listed', text: 'Listed people' },
  ],
}

/**
 * An app's sign-in: people sign in with a code emailed to them. Not placed (an Account feature on a page shows the
 * sign-in and sign-out buttons), one per model, and enforced only by the Worker on the published app; the builder's
 * canvas is never signed in.
 */
export const SignInFeature: FeatureDefinition = {
  type: SIGN_IN_FEATURE,
  name: 'Sign-in',
  icon: 'lock',
  placement: 'none',
  single: true,
  inputs: [
    nameInput('Sign-in'),
    disableInput,
    openToInput,
    {
      name: 'allowed',
      label: 'Emails and domains',
      type: 'list',
      default: [],
      control: 'list-input',
      placeholder: 'ann@example.com',
      hint: 'One per line: an email, or @example.com for everyone there. Only they can sign in.',
      showWhen: { input: 'open_to', equals: 'listed' },
    },
    {
      name: 'sign_up',
      label: 'New people can make an account',
      type: 'boolean',
      default: true,
      control: 'checkbox-input',
      hint: 'Off: only people who already have an account can sign in.',
      showWhen: { input: 'open_to', notEquals: 'listed' },
    },
  ],

  generate(inputs, ctx) {
    const stored = asString(inputs.open_to)
    // An unknown choice fails closed (and is an error, so it isn't published): never an app opened by a typo.
    const openTo = (OPEN_TO as readonly string[]).includes(stored) ? (stored as OpenTo) : 'signed-in'
    if (openTo !== stored) ctx.report('error', `"${stored}" isn't a choice of who can open the app: choose one`)
    if (openTo !== 'listed') return { exports: { signIn: { openTo, allowed: null, signUp: asBool(inputs.sign_up) } } satisfies SignInExports }

    const allowed: string[] = []
    for (const line of asList(inputs.allowed)) {
      if (line.trim() === '') continue
      const entry = readAllowedEntry(line)
      if (entry === undefined) ctx.report('warning', `"${line.trim()}" is neither an email nor an @domain, so it is left out`)
      else if (!allowed.includes(entry)) allowed.push(entry)
    }
    if (allowed.length > MAX_ALLOWED_ENTRIES) {
      ctx.report('warning', `Only the first ${MAX_ALLOWED_ENTRIES} emails and domains are used`)
      allowed.length = MAX_ALLOWED_ENTRIES
    }
    // An error: published, the app would open for no one, its author included.
    if (allowed.length === 0) ctx.report('error', 'List the emails or domains of the people who can open the app')
    // The list is the gate: everyone on it may make an account.
    return { exports: { signIn: { openTo, allowed, signUp: true } } satisfies SignInExports }
  },
}

/** The app's sign-in, from its generated Sign-in feature; null when it has none (or it is disabled or skipped). */
export function signInOf(result: GenerateResult): SignInSettings | null {
  const feature = result.metadata.features.find((f) => f.feature === SIGN_IN_FEATURE && f.status === 'generated')
  const exports = feature && result.exports.get(feature.id)
  return isSignInExports(exports) ? exports.signIn : null
}

/** Whether an address is on the list: an exact email, or one at a listed `@domain` (case doesn't matter). */
export function onAllowedList(allowed: readonly string[], email: string): boolean {
  const address = email.trim().toLowerCase()
  return allowed.some((listed) => {
    const entry = listed.trim().toLowerCase()
    return entry !== '' && (entry.startsWith('@') ? address.endsWith(entry) : address === entry)
  })
}
