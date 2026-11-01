// A published app's sign-in page and Account, against a fake of the app's sign-in endpoints (the Worker's are tested
// in packages/worker/test/signIn.test.ts, and end to end in e2e/signIn.spec.ts).

import { signInDocument, type DocNodeOf } from '@feature-domain/engine'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadAccount, linkedSignIn, readCode, sendCode, SIGNED_IN, signInWithCode } from '../src/renderer/account'
import { provideDataStore } from '../src/renderer/data'
import DocumentView from '../src/renderer/DocumentView.vue'
import AccountNode from '../src/renderer/nodes/AccountNode.vue'
import PublishedApp from '../src/views/PublishedApp.vue'
import { inst, model, page } from './helpers'
import { defineComponent, h } from 'vue'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** A fake of the app's endpoints: answers by path, recording what was sent. */
function fakeApp(answers: Record<string, () => Response>) {
  const sent: { path: string; method: string; body?: unknown }[] = []
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    sent.push({ path, method: init?.method ?? 'GET', ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) })
    const answer = answers[path]
    return answer ? answer() : json({ error: 'No such API endpoint' }, 404)
  })
  vi.stubGlobal('fetch', fetchImpl)
  return sent
}

const at = (path: string) => window.history.replaceState(null, '', path)

beforeEach(() => at('/'))
afterEach(() => vi.unstubAllGlobals())

describe('reading the emailed link', () => {
  it('takes the email from the query and the six digits after #code=', () => {
    expect(linkedSignIn({ search: '?email=ann%40example.com', hash: '#code=123456' })).toEqual({ email: 'ann@example.com', code: '123456' })
    expect(linkedSignIn({ search: '', hash: '#code=12' })).toEqual({ email: '', code: '' })
    expect(readCode(' 123 456 ')).toBe('123456')
    expect(readCode('123-456')).toBe('123456')
    expect(readCode('12345')).toBeUndefined()
    expect(readCode('12345a')).toBeUndefined()
  })
})

describe('the sign-in calls', () => {
  const html = (status = 200) => new Response('<html>Sign in</html>', { status, headers: { 'Content-Type': 'text/html' } })
  const text = () => new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } })

  it('give every request a time limit, so a stalled one fails rather than waiting forever', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      throw new DOMException('The operation timed out.', 'TimeoutError')
    })
    await expect(sendCode('ann@example.com', fetchImpl)).rejects.toThrow("Couldn't reach the app.")
    await expect(downloadAccount(fetchImpl)).rejects.toThrow("Couldn't reach the app.")
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('never take an Access sign-in page, or any answer that is not the app’s JSON, as success', async () => {
    await expect(sendCode('ann@example.com', async () => html())).rejects.toThrow('Your sign-in to this site has expired.')
    await expect(signInWithCode('ann@example.com', '123456', async () => html())).rejects.toThrow('Your sign-in to this site has expired.')
    await expect(signInWithCode('ann@example.com', '123456', async () => text())).rejects.toThrow("Couldn't reach the app.")
    // A body whose read is cut off (the time limit) is no success either.
    const cut = new Response('{"us', { status: 200, headers: { 'Content-Type': 'application/json' } })
    await expect(signInWithCode('ann@example.com', '123456', async () => cut)).rejects.toThrow("Couldn't reach the app.")
  })

  it('download only the app’s JSON as the file', async () => {
    await expect(downloadAccount(async () => html())).rejects.toThrow('Your sign-in to this site has expired.')
    await expect(downloadAccount(async () => text())).rejects.toThrow("Your data couldn't be downloaded (200).")
    const file = await downloadAccount(async () => json({ account: { email: 'ann@example.com' } }))
    expect(JSON.parse(await file.text())).toEqual({ account: { email: 'ann@example.com' } })
  })
})

describe('the sign-in page', () => {
  const form = (props: DocNodeOf<'sign-in'>['props'] = { app: 'Members' }) => {
    const signedIn = vi.fn()
    const w = mount(DocumentView, {
      props: { root: signInDocument(props.app, props.refused ? { refused: props.refused } : {}) },
      global: { provide: { [SIGNED_IN as symbol]: signedIn } },
      attachTo: document.body,
    })
    return { w, signedIn }
  }

  it('emails a code, then signs in with it', async () => {
    const sent = fakeApp({
      '/api/v1/app/auth/email-otp/send-verification-otp': () => json({ success: true }),
      '/api/v1/app/auth/sign-in/email-otp': () => json({ user: { email: 'ann@example.com' } }),
    })
    const { w, signedIn } = form()
    expect(w.find('h1').text()).toBe('Sign in to Members')
    expect(w.text()).toContain("The app's owner can see them")
    await w.find('input[type=email]').setValue(' ann@example.com ')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(sent).toEqual([{ path: '/api/v1/app/auth/email-otp/send-verification-otp', method: 'POST', body: { email: 'ann@example.com', type: 'sign-in' } }])
    expect(w.text()).toContain('If ann@example.com can sign in, a code is on its way.')
    expect(document.activeElement).toBe(w.find('input[autocomplete=one-time-code]').element)
    await w.find('input[autocomplete=one-time-code]').setValue('123 456')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(sent.at(-1)).toEqual({ path: '/api/v1/app/auth/sign-in/email-otp', method: 'POST', body: { email: 'ann@example.com', otp: '123456' } })
    expect(signedIn).toHaveBeenCalledOnce()
    w.unmount()
  })

  it('says what is wrong: not an email, not six digits, a wrong code, too many tries', async () => {
    let otp = () => json({ code: 'INVALID_OTP', message: 'Invalid OTP' }, 400)
    fakeApp({ '/api/v1/app/auth/email-otp/send-verification-otp': () => json({ success: true }), '/api/v1/app/auth/sign-in/email-otp': () => otp() })
    const { w, signedIn } = form()
    await w.find('input[type=email]').setValue('ann')
    await w.find('form').trigger('submit')
    expect(w.find('[role=alert]').text()).toBe('Enter your email address, such as ann@example.com.')
    await w.find('input[type=email]').setValue('ann@example.com')
    await w.find('form').trigger('submit')
    await flushPromises()
    await w.find('input[autocomplete=one-time-code]').setValue('12')
    await w.find('form').trigger('submit')
    expect(w.find('[role=alert]').text()).toBe('Enter the six digits from the email.')
    await w.find('input[autocomplete=one-time-code]').setValue('000000')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(w.find('[role=alert]').text()).toBe("That code isn't right, or it has expired. Check it, or ask for a new one.")
    otp = () => json({ code: 'TOO_MANY_ATTEMPTS', message: 'Too many attempts' }, 403)
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(w.find('[role=alert]').text()).toBe('Too many tries with that code. Ask for a new one.')
    expect(signedIn).not.toHaveBeenCalled()
    // Another email starts over.
    await w
      .findAll('button')
      .find((b) => b.text() === 'Use another email')!
      .trigger('click')
    expect(w.find('input[type=email]').exists()).toBe(true)
    w.unmount()
  })

  it('signs in with the address the code went to, the field locked while it is sent', async () => {
    let sent!: () => void
    const calls = fakeApp({
      '/api/v1/app/auth/email-otp/send-verification-otp': () => json({ success: true }),
      '/api/v1/app/auth/sign-in/email-otp': () => json({ user: { email: 'ann@example.com' } }),
    })
    const answered = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementationOnce(async (input, init) => (await new Promise<void>((r) => (sent = r)), answered(input, init)))
    const { w } = form()
    await w.find('input[type=email]').setValue('ann@example.com')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(w.find('input[type=email]').attributes('readonly')).toBeDefined()
    // Even a change that gets through meanwhile doesn't move the code to another address.
    await w.find('input[type=email]').setValue('bo@example.com')
    sent()
    await flushPromises()
    expect(w.text()).toContain('If ann@example.com can sign in, a code is on its way.')
    await w.find('input[autocomplete=one-time-code]').setValue('123456')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(calls.at(-1)).toMatchObject({ body: { email: 'ann@example.com', otp: '123456' } })
    w.unmount()
  })

  it('fills in the emailed link’s email and code, waits for a press, and drops the code from the address', async () => {
    at('/sign-in?email=ann%40example.com#code=654321')
    const sent = fakeApp({ '/api/v1/app/auth/sign-in/email-otp': () => json({ user: { email: 'ann@example.com' } }) })
    const { w, signedIn } = form()
    await flushPromises()
    expect((w.find('input[autocomplete=one-time-code]').element as HTMLInputElement).value).toBe('654321')
    expect(window.location.hash).toBe('')
    expect(window.location.search).toBe('?email=ann%40example.com')
    expect(sent).toEqual([])
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(sent).toEqual([{ path: '/api/v1/app/auth/sign-in/email-otp', method: 'POST', body: { email: 'ann@example.com', otp: '654321' } }])
    expect(signedIn).toHaveBeenCalledOnce()
    w.unmount()
  })

  it('offers someone the list leaves out to sign out, then to sign in with another email', async () => {
    const sent = fakeApp({ '/api/v1/app/auth/sign-out': () => json({ success: true }) })
    const { w } = form({ app: 'Board', refused: 'eve@example.com' })
    expect(w.text()).toContain("You're signed in as eve@example.com, and Board is open only to the people it lists.")
    await w.find('button').trigger('click')
    await flushPromises()
    expect(sent).toEqual([{ path: '/api/v1/app/auth/sign-out', method: 'POST', body: {} }])
    expect(w.find('input[type=email]').exists()).toBe(true)
    w.unmount()
  })

  it('keeps an emailed link’s code past signing out someone the list leaves out, and out of the address', async () => {
    at('/sign-in?email=ann%40example.com#code=654321')
    fakeApp({ '/api/v1/app/auth/sign-out': () => json({ success: true }) })
    const { w } = form({ app: 'Board', refused: 'eve@example.com' })
    await flushPromises()
    expect(window.location.hash).toBe('')
    await w.find('button').trigger('click')
    await flushPromises()
    expect((w.find('input[autocomplete=one-time-code]').element as HTMLInputElement).value).toBe('654321')
    w.unmount()
  })
})

describe('PublishedApp and sign-in', () => {
  const app = (features = [page(), inst('SignInFeature', 's', {}, null)]) => json({ ...model(...features), id: 'm1', name: 'Members' })

  it('shows the sign-in page where the app asks for it, in its theme', async () => {
    const tokens = (await import('@feature-domain/engine')).deriveTokens((await import('@feature-domain/engine')).DEFAULT_THEME)
    fakeApp({ '/api/v1/app': () => json({ error: 'Sign in to open this app', sign_in: { app: 'Members', theme: tokens } }, 401) })
    const w = mount(PublishedApp)
    await flushPromises()
    expect(w.find('h1').text()).toBe('Sign in to Members')
    expect(document.title).toBe('Sign in · Members')
    expect(w.find('[data-fd-scheme]').exists()).toBe(true)
  })

  it('shows it at /sign-in for an app with sign-in, and the app itself for one without', async () => {
    at('/sign-in')
    fakeApp({ '/api/v1/app': () => app() })
    const w = mount(PublishedApp)
    await flushPromises()
    expect(w.find('h1').text()).toBe('Sign in to Members')
    fakeApp({ '/api/v1/app': () => app([page(), inst('TextFeature', 't', { text: 'Hello there' })]) })
    const plain = mount(PublishedApp)
    await flushPromises()
    expect(plain.text()).toContain('Hello there')
    expect(plain.find('.fd-sign-in').exists()).toBe(false)
  })

  it('sends someone already signed in from /sign-in on to the app', async () => {
    const replace = vi.fn()
    vi.stubGlobal('location', { ...window.location, pathname: '/sign-in', search: '', hash: '', replace })
    fakeApp({ '/api/v1/app': () => app(), '/api/v1/app/auth/get-session': () => json({ user: { id: 'u1', email: 'ann@example.com', name: '' }, session: {} }) })
    const w = mount(PublishedApp)
    await flushPromises()
    expect(replace).toHaveBeenCalledWith('/')
    expect(w.find('.fd-sign-in').exists()).toBe(false)
  })
})

describe('the Account', () => {
  const account = (onApp: boolean) => {
    const Host = defineComponent({
      setup() {
        provideDataStore(onApp ? { model: 'm1', app: true } : undefined)
        return () => h(AccountNode, { node: { id: 'a', kind: 'account', props: { signInText: 'Members', align: 'right' }, children: [] } })
      },
    })
    return mount(Host, { attachTo: document.body })
  }
  const assign = vi.fn()
  beforeEach(() => {
    assign.mockReset()
    vi.stubGlobal('location', { ...window.location, assign, pathname: '/', search: '', hash: '' })
  })

  it('in the builder: the signed-out look, doing nothing', async () => {
    const sent = fakeApp({})
    const w = account(false)
    await flushPromises()
    expect(w.find('span.fd-button').text()).toBe('Members')
    expect(w.find('a').exists()).toBe(false)
    expect(sent).toEqual([])
  })

  it('says when it couldn’t check who is signed in, with Try again', async () => {
    let session = () => json({ error: 'Unavailable' }, 503)
    fakeApp({ '/api/v1/app/auth/get-session': () => session() })
    const w = account(true)
    await flushPromises()
    expect(w.find('[role=alert]').text()).toContain("Couldn't check who is signed in.")
    session = () => json(null)
    await w.find('button').trigger('click')
    await flushPromises()
    expect(w.find('a').attributes('href')).toBe('/sign-in')
  })

  it('on an app: Sign in for someone signed out, nothing without sign-in', async () => {
    fakeApp({ '/api/v1/app/auth/get-session': () => json(null) })
    const w = account(true)
    await flushPromises()
    expect(w.find('a').attributes('href')).toBe('/sign-in')
    expect(w.find('a').text()).toBe('Members')
    fakeApp({})
    const none = account(true)
    await flushPromises()
    expect(none.html()).toBe('<!--v-if-->')
  })

  it('signed in: who, Sign out, their data, and Delete asked first', async () => {
    const sent = fakeApp({
      '/api/v1/app/auth/get-session': () => json({ user: { id: 'u1', email: 'ann@example.com', name: '' }, session: {} }),
      '/api/v1/app/auth/sign-out': () => json({ success: true }),
      '/api/v1/app/auth/delete-user': () => json({ code: 'SESSION_EXPIRED', message: 'Session expired' }, 403),
      '/api/v1/app/account': () => json({ error: 'Sign in first' }, 401),
    })
    const w = account(true)
    await flushPromises()
    expect(w.text()).toContain('Signed in as ann@example.com')
    const button = (text: string) => w.findAll('button').find((b) => b.text() === text)!
    // A session that ended meanwhile is said, not saved as a file.
    await button('Download my data').trigger('click')
    await flushPromises()
    expect(sent.at(-1)).toMatchObject({ path: '/api/v1/app/account', method: 'GET' })
    expect(w.find('[role=alert]').text()).toBe('You were signed out. Sign in again to download your data.')
    await button('Delete my account').trigger('click')
    expect(w.text()).toContain("Delete your account? This can't be undone.")
    expect(document.activeElement).toBe(button('Delete').element)
    await button('Delete').trigger('click')
    await flushPromises()
    expect(w.find('[role=alert]').text()).toBe('For your safety, sign in again before deleting your account.')
    await button('Keep').trigger('click')
    expect(document.activeElement).toBe(button('Delete my account').element)
    await button('Sign out').trigger('click')
    await flushPromises()
    expect(sent.at(-1)).toEqual({ path: '/api/v1/app/auth/sign-out', method: 'POST', body: {} })
    expect(assign).toHaveBeenCalledWith('/')
  })
})
