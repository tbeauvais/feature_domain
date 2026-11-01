import { describe, expect, it } from 'vitest'
import { generate, MAX_ALLOWED_ENTRIES, onAllowedList, readAllowedEntry, signInDocument, signInOf } from '../src'
import type { InputValue } from '../src'
import { inst, model, page } from './helpers'

const signIn = (inputs: Record<string, InputValue> = {}, id = 's') => inst('SignInFeature', id, inputs, null)
const read = (...features: ReturnType<typeof signIn>[]) => {
  const result = generate(model(page(), ...features))
  return { settings: signInOf(result), problems: result.diagnostics.map((d) => [d.severity, d.featureInstanceId, d.message]), result }
}

describe('SignInFeature', () => {
  it('is open to anyone, who may sign up, by default', () => {
    expect(read(signIn())).toMatchObject({ settings: { openTo: 'anyone', allowed: null, signUp: true }, problems: [] })
  })

  it('can close sign-up, and open the app only to people signed in', () => {
    expect(read(signIn({ open_to: 'signed-in', sign_up: false })).settings).toEqual({ openTo: 'signed-in', allowed: null, signUp: false })
  })

  it('reads the list of emails and domains, lowercase, once each, leaving out what is neither', () => {
    const { settings, problems } = read(
      signIn({ open_to: 'listed', sign_up: false, allowed: [' Ann@Example.com ', '@team.example.org', '', 'ann@example.com', 'bob', 'x@y', '@'] }),
    )
    // The list is the gate: a stored Sign-up switch, hidden for a list, doesn't lock listed people out.
    expect(settings).toEqual({ openTo: 'listed', allowed: ['ann@example.com', '@team.example.org'], signUp: true })
    expect(problems).toEqual([
      ['warning', 's', '"bob" is neither an email nor an @domain, so it is left out'],
      ['warning', 's', '"x@y" is neither an email nor an @domain, so it is left out'],
      ['warning', 's', '"@" is neither an email nor an @domain, so it is left out'],
    ])
  })

  it('is an error when no one is listed (no one could open the app), and keeps the list to its longest', () => {
    expect(read(signIn({ open_to: 'listed' }))).toMatchObject({
      settings: { allowed: [] },
      problems: [['error', 's', 'List the emails or domains of the people who can open the app']],
    })
    expect(read(signIn({ open_to: 'listed', allowed: ['bob'] })).problems.map((p) => p[0])).toEqual(['warning', 'error'])
    const many = Array.from({ length: MAX_ALLOWED_ENTRIES + 2 }, (_, i) => `p${i}@example.com`)
    const { settings, problems } = read(signIn({ open_to: 'listed', allowed: many }))
    expect(settings!.allowed).toHaveLength(MAX_ALLOWED_ENTRIES)
    expect(problems).toEqual([['warning', 's', `Only the first ${MAX_ALLOWED_ENTRIES} emails and domains are used`]])
  })

  it('names a few unreadable lines and counts the rest, and a list of only bad domains is an error', () => {
    const { settings, problems } = read(signIn({ open_to: 'listed', allowed: Array.from({ length: 8 }, (_, i) => `ann@example.com/${i}`) }))
    expect(settings!.allowed).toEqual([])
    expect(problems.map((p) => p[2])).toEqual([
      ...Array.from({ length: 5 }, (_, i) => `"ann@example.com/${i}" is neither an email nor an @domain, so it is left out`),
      '3 more lines are neither an email nor an @domain, so they are left out',
      'List the emails or domains of the people who can open the app',
    ])
  })

  it('reads a very long list only as far as it uses', () => {
    const huge = Array.from({ length: 50_000 }, (_, i) => `p${i}@example.com`)
    const started = performance.now()
    expect(read(signIn({ open_to: 'listed', allowed: huge })).settings!.allowed).toHaveLength(MAX_ALLOWED_ENTRIES)
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('reads an unknown choice as signed in only, never anyone, with an error so it is not published', () => {
    expect(read(signIn({ open_to: 'signed_in' }))).toMatchObject({
      settings: { openTo: 'signed-in' },
      problems: [['error', 's', '"signed_in" isn\'t a choice of who can open the app: choose one']],
    })
  })

  it('gives no sign-in when there is none, or it is disabled', () => {
    expect(read().settings).toBeNull()
    expect(read(signIn({ disable: true })).settings).toBeNull()
  })

  it('is one per app: a second one is skipped with an error, so the model cannot be published', () => {
    const { settings, problems, result } = read(signIn({ open_to: 'signed-in' }, 's1'), signIn({ open_to: 'anyone' }, 's2'))
    expect(settings!.openTo).toBe('signed-in')
    expect(problems).toEqual([['error', 's2', 'An app has one Sign-in: feature s1 ("SignInFeature s1") is the one used, so remove this one']])
    expect(result.diagnostics[0]!.code).toBe('duplicate-single')
    expect(result.metadata.features.find((f) => f.id === 's2')).toMatchObject({ status: 'skipped', reason: expect.stringContaining('An app has one Sign-in') })
  })

  it('lets a second one take over when the first is disabled', () => {
    expect(read(signIn({ disable: true }, 's1'), signIn({ open_to: 'signed-in' }, 's2'))).toMatchObject({
      settings: { openTo: 'signed-in' },
      problems: [['info', 's1', 'Feature is suppressed']],
    })
  })
})

describe('allowed lists', () => {
  it('reads an email or an @domain', () => {
    expect(readAllowedEntry(' Ann@Example.COM ')).toBe('ann@example.com')
    expect(readAllowedEntry('@example.co.uk')).toBe('@example.co.uk')
    expect(readAllowedEntry('first.last+tag@xn--bcher-kva.example')).toBe('first.last+tag@xn--bcher-kva.example')
    expect(readAllowedEntry('ann@mail-1.example.com')).toBe('ann@mail-1.example.com')
    for (const bad of [
      'ann',
      'ann@',
      '@',
      '@example',
      'a b@example.com',
      'a@b@example.com',
      'ann@example..com',
      'ann@.example.com',
      'ann@example.com/',
      '@example.com/path',
      '@-example.com',
      '@example-.com',
      'a@exa_mple.com',
      'a@example.c0m',
      'a@example.c',
      'a\u0000b@example.com',
    ])
      expect(readAllowedEntry(bad)).toBeUndefined()
  })

  it('matches an exact email or one at a listed domain, never a subdomain or a lookalike', () => {
    const list = ['ann@example.com', '@team.example.org']
    expect(onAllowedList(list, ' ANN@example.com')).toBe(true)
    expect(onAllowedList(list, 'bob@team.example.org')).toBe(true)
    expect(onAllowedList(list, 'bob@example.com')).toBe(false)
    expect(onAllowedList(list, 'bob@sub.team.example.org')).toBe(false)
    expect(onAllowedList(list, 'bob@evilteam.example.org')).toBe(false)
    // A list not read through readAllowedEntry still matches whatever the case and spaces, and a blank entry matches no one.
    expect(onAllowedList([' @Team.Example.ORG '], 'bob@team.example.org')).toBe(true)
    expect(onAllowedList(['', ' '], '')).toBe(false)
  })
})

describe('AccountFeature', () => {
  const account = (inputs: Record<string, InputValue> = {}) => generate(model(page(), inst('AccountFeature', 'a', inputs))).root.children[0]!.children[0]!

  it('is an account node: its sign-in words, placed at the right', () => {
    expect(account()).toMatchObject({ kind: 'account', id: 'a', props: { signInText: 'Sign in', align: 'right' } })
    expect(account({ sign_in_text: ' Members ', align: 'left' }).props).toEqual({ signInText: 'Members', align: 'left' })
    expect(account({ sign_in_text: '  ' }).props).toMatchObject({ signInText: 'Sign in' })
    // Its words are edited in place, unless they are the default standing in for an empty input.
    expect(account().edit).toEqual({ signInText: { input: 'sign_in_text', kind: 'text' } })
    expect(account({ sign_in_text: '' }).edit).toBeUndefined()
  })
})

describe('signInDocument', () => {
  it("is a page holding the sign-in form, in the app's theme when given", () => {
    const plain = signInDocument('Members')
    expect(plain).toMatchObject({ kind: 'root', children: [{ kind: 'page', props: {}, children: [{ kind: 'sign-in', props: { app: 'Members' } }] }] })
    const theme = generate(model(inst('ThemeFeature', 't', {}, null), page({ theme: 't' }))).root.children[0]!.props as { theme: unknown }
    const themed = signInDocument('Board', { theme: theme.theme as never, refused: 'eve@example.com' })
    expect(themed.children[0]!.props).toEqual({ theme: theme.theme })
    expect(themed.children[0]!.children[0]!.props).toEqual({ app: 'Board', refused: 'eve@example.com' })
  })
})
