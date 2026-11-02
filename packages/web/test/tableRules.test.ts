import { generate, SIGN_IN_FEATURE, type AppModel, type InputValue } from '@feature-domain/engine'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataStore } from '../src/renderer/data'
import DocumentView from '../src/renderer/DocumentView.vue'
import { FETCH_JSON, SEND_REQUEST, type FetchJson, type SendRequest } from '../src/renderer/rows'
import { inst, model, page } from './helpers'

// A Database table's rules on a published app's page: the page offers a form, a row's Delete and a row's change only
// to someone the Worker would let use them (the Worker enforces them; packages/worker/test/tableRules.test.ts). The
// builder's draft rows have no rules, so the editor and the preview show every control.

const ANN = 'u-ann'
const ROWS = [
  { id: '01ARYZ6S410000000000000001', title: 'Sample', status: 'open' },
  { id: '01ARYZ6S410000000000000002', title: 'Ann’s', status: 'open', created_by: ANN },
]

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** The app's session: who is signed in (null for no one), or no sign-in at all (`'none'`, a 404). */
function session(who: string | null | 'none') {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) !== '/api/v1/app/auth/get-session' || who === 'none') return json({ error: 'No such API endpoint' }, 404)
    return json(who ? { user: { id: who, email: `${who}@example.com`, name: '' }, session: {} } : null)
  })
  vi.stubGlobal('fetch', fetchImpl)
  return fetchImpl
}
afterEach(() => vi.unstubAllGlobals())

function club(rules: Record<string, InputValue>): AppModel {
  return model(
    inst(SIGN_IN_FEATURE, 's', {}, null),
    inst('DatabaseTableFeature', '2', { name: 'Bookings', fields: ['title: text, required', 'status: choice open | done'], ...rules }, null),
    page(),
    inst('FormFeature', 'f', { data_resource: '2', title: 'Book', submit_label: 'Book it' }),
    inst('TableFeature', 't', { data_resource: '2', delete_operation: 'DELETE rows', update_operation: 'PATCH rows' }),
  )
}

function render(m: AppModel, { app = true } = {}) {
  const fetchJson = vi.fn<FetchJson>(async () => structuredClone(ROWS))
  const send = vi.fn<SendRequest>(async () => ({}))
  const w = mount(DocumentView, {
    props: { root: generate(m).root, modelId: 'm1', app },
    global: { provide: { [FETCH_JSON as symbol]: fetchJson, [SEND_REQUEST as symbol]: send } },
    attachTo: document.body,
  })
  return w
}

/** Per row, by title: whether it offers Delete and a select to change it. */
const controls = (w: ReturnType<typeof mount>) =>
  Object.fromEntries(
    w.findAll('tbody tr').map((tr) => [tr.findAll('td')[0]!.text(), { delete: tr.find('[data-delete-row]').exists(), change: tr.find('select').exists() }]),
  )

describe('on a published app', () => {
  it('offers changes and deletes under Owner only on the visitor’s own rows (the Worker marks them)', async () => {
    session(ANN)
    const w = render(club({ add_rows: 'signed-in', change_rows: 'owner', delete_rows: 'owner' }))
    await flushPromises()
    expect(controls(w)).toEqual({ Sample: { delete: false, change: false }, 'Ann’s': { delete: true, change: true } })
    expect(w.find('form').exists()).toBe(true)
    w.unmount()
  })

  it('has no Delete column where the visitor may delete none, and asks people signed out to sign in to use the form', async () => {
    session(null)
    const w = render(club({ add_rows: 'signed-in', change_rows: 'signed-in', delete_rows: 'owner' }))
    await flushPromises()
    expect(controls(w)).toEqual({ Sample: { delete: false, change: false }, 'Ann’s': { delete: false, change: false } })
    expect(w.find('th.fd-table-actions').exists()).toBe(false)
    expect(w.find('form').exists()).toBe(false)
    const prompt = w.get('.fd-form[role=group]')
    expect(prompt.text()).toContain('Only people signed in can use this form.')
    expect(prompt.get('a').attributes('href')).toBe('/sign-in')
    w.unmount()
  })

  it('shows nothing of what no one may do, and asks who is signed in once for the whole page', async () => {
    const fetchImpl = session(ANN)
    const w = render(club({ add_rows: 'nobody', change_rows: 'nobody', delete_rows: 'signed-in' }))
    await flushPromises()
    expect(w.find('.fd-form').exists()).toBe(false)
    expect(controls(w)).toEqual({ Sample: { delete: true, change: false }, 'Ann’s': { delete: true, change: false } })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('keeps who added a row from every reader of the rows: a text reading it shows nothing', async () => {
    session(ANN)
    const m = club({ add_rows: 'signed-in', change_rows: 'owner', delete_rows: 'owner' })
    m.features.push(inst('TextFeature', 'x', { text: 'By {{1.created_by}}', data_resource: '2' }))
    const w = render(m)
    await flushPromises()
    expect(controls(w)['Ann’s']).toEqual({ delete: true, change: true })
    expect(w.text()).toContain('By —')
    expect(w.text()).not.toContain(ANN)
    w.unmount()
  })

  it('says when it couldn’t check who is signed in, in place of the form, with Try again', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'Unavailable' }, 503)),
    )
    const w = render(club({ add_rows: 'signed-in' }))
    await flushPromises()
    expect(w.find('form').exists()).toBe(false)
    expect(w.get('.fd-form [role=alert]').text()).toContain("Couldn't check who is signed in")
    session(ANN)
    await w.get('.fd-form [role=alert] button').trigger('click')
    await flushPromises()
    expect(w.find('form').exists()).toBe(true)
    w.unmount()
  })

  it('offers a form changing a row under Owner to anyone signed in: the Worker checks whose row it is', async () => {
    session(ANN)
    const m = club({ change_rows: 'owner' })
    m.features.push(inst('FormFeature', 'g', { data_resource: '2', operation: 'PATCH rows', title: 'Change', submit_label: 'Change it' }))
    const w = render(m)
    await flushPromises()
    expect(w.findAll('form')).toHaveLength(2)
    w.unmount()
    session(null)
    const signedOut = render(m)
    await flushPromises()
    expect(signedOut.findAll('form')).toHaveLength(1)
    expect(signedOut.get('.fd-form[role=group]').text()).toContain('Only people signed in can use this form.')
    signedOut.unmount()
  })

  it('says when it couldn’t check who is signed in for a table’s controls, with Try again', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'Unavailable' }, 503)),
    )
    const m = club({ delete_rows: 'owner' })
    m.features = m.features.filter((f) => f.feature !== 'FormFeature')
    const w = render(m)
    await flushPromises()
    expect(controls(w)['Ann’s']).toEqual({ delete: false, change: true })
    expect(w.get('.fd-table-note[role=alert]').text()).toContain("Couldn't check who is signed in")
    session(ANN)
    await w.get('.fd-table-note[role=alert] button').trigger('click')
    await flushPromises()
    expect(controls(w)['Ann’s']).toEqual({ delete: true, change: true })
    expect(w.find('.fd-table-note[role=alert]').exists()).toBe(false)
    w.unmount()
  })

  it('asks no one who is signed in for a table open to anyone', async () => {
    const fetchImpl = session(ANN)
    const w = render(club({}))
    await flushPromises()
    expect(controls(w)).toEqual({ Sample: { delete: true, change: true }, 'Ann’s': { delete: true, change: true } })
    expect(fetchImpl).not.toHaveBeenCalled()
    w.unmount()
  })
})

describe('in the builder and its preview', () => {
  it('offers everything: rules apply only to the published app’s rows', async () => {
    const fetchImpl = session(null)
    const w = render(club({ add_rows: 'nobody', change_rows: 'owner', delete_rows: 'nobody' }), { app: false })
    await flushPromises()
    expect(w.find('form').exists()).toBe(true)
    expect(controls(w)).toEqual({ Sample: { delete: true, change: true }, 'Ann’s': { delete: true, change: true } })
    expect(fetchImpl).not.toHaveBeenCalled()
    w.unmount()
  })
})

describe('DataStore.allows', () => {
  const action = { feature: '2', resource: 'Bookings', operation: 'DELETE rows', method: 'DELETE', endPoint: 'tables/2/rows/{id}' } as const
  const store = () => new DataStore(vi.fn<FetchJson>(), { model: 'm1', app: true })

  it('is not known until it has asked who is signed in, then goes by the rule', async () => {
    session(ANN)
    const s = store()
    expect(s.allows({ ...action, rule: 'signed-in' })).toBe('unknown')
    s.checkVisitorFor({ ...action, rule: 'signed-in' })
    await flushPromises()
    expect(s.allows({ ...action, rule: 'signed-in' })).toBe('yes')
    // A row the Worker didn't mark as hers (only the store's own record counts, never a key a row holds).
    expect(s.allows({ ...action, rule: 'owner' }, { created_by: ANN })).toBe('no')
    expect(s.allows({ ...action, rule: 'owner' })).toBe('yes')
    expect(s.allows({ ...action, rule: 'nobody' })).toBe('no')
    expect(s.allows(action)).toBe('yes')
  })

  it('says to sign in for no one signed in, and no in an app without sign-in', async () => {
    session(null)
    const signedOut = store()
    void signedOut.whoIsSignedIn()
    await flushPromises()
    expect(signedOut.allows({ ...action, rule: 'owner' }, ROWS[1])).toBe('sign-in')
    session('none')
    const none = store()
    await none.whoIsSignedIn().catch(() => undefined)
    expect(none.allows({ ...action, rule: 'signed-in' })).toBe('no')
  })

  it('asks again after a check that failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'Unavailable' }, 503)),
    )
    const s = store()
    await expect(s.whoIsSignedIn()).rejects.toThrow()
    expect(s.visitor.value).toMatchObject({ status: 'failed' })
    session(ANN)
    await expect(s.whoIsSignedIn()).resolves.toMatchObject({ id: ANN })
  })
})
