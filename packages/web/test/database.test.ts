import { generate, type AppModel, type InputValue } from '@feature-domain/engine'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, provide } from 'vue'
import TableFieldsField from '../src/editor/TableFieldsField.vue'
import { DataStore, PROXY_READY } from '../src/renderer/data'
import DocumentView from '../src/renderer/DocumentView.vue'
import { browserFetchJson, browserSendRequest, FETCH_JSON, SEND_REQUEST, type FetchJson, type SendRequest } from '../src/renderer/rows'
import { inst, model, page } from './helpers'

// A Database table's rows on a page: fetched and sent at the page's own model on this site, after the pending save.

const FIELDS = ['title: text, required', 'notes: long text', 'priority: choice low | normal | urgent, default normal', 'due: date', 'done: yes/no']
const requests = (inputs: Record<string, InputValue> = {}) => inst('DatabaseTableFeature', '2', { name: 'Requests', fields: FIELDS, ...inputs }, null)

function render(
  m: AppModel,
  { fetchJson = vi.fn<FetchJson>(async () => []), send = vi.fn<SendRequest>(async () => ({})), modelId = 'm 1' as string | null } = {},
) {
  const w = mount(DocumentView, {
    props: { root: generate(m).root, ...(modelId ? { modelId } : {}) },
    global: { provide: { [FETCH_JSON as symbol]: fetchJson, [SEND_REQUEST as symbol]: send } },
    attachTo: document.body,
  })
  return { w, fetchJson, send }
}

const labeled = (w: ReturnType<typeof mount>, label: string) => {
  const id = w
    .findAll('label')
    .find((l) => l.text().replace(' *', '') === label)!
    .attributes('for')
  return w.get(`#${id}`)
}

describe("a Database table's rows on a page", () => {
  it("are read at the page's own model on this site, and a row is deleted there", async () => {
    const fetchJson = vi.fn<FetchJson>(async () => [{ id: '01ARYZ6S410000000000000000', title: 'Fix the door' }])
    const { w, send } = render(model(requests(), page(), inst('TableFeature', 't', { data_resource: '2', delete_operation: 'DELETE rows' })), { fetchJson })
    await flushPromises()
    expect(fetchJson).toHaveBeenCalledWith('/api/v1/models/m%201/tables/2/rows')
    expect(w.find('tbody').text()).toContain('Fix the door')
    await w.get('button[aria-label^="Delete row"]').trigger('click')
    await w
      .findAll('button')
      .find((b) => b.text() === 'Delete')!
      .trigger('click')
    await flushPromises()
    expect(send).toHaveBeenCalledWith({ method: 'DELETE', url: '/api/v1/models/m%201/tables/2/rows/01ARYZ6S410000000000000000' })
    w.unmount()
  })

  it('need a saved model', async () => {
    const { w, fetchJson } = render(model(requests(), page(), inst('TableFeature', 't', { data_resource: '2' })), { modelId: null })
    await flushPromises()
    expect(fetchJson).not.toHaveBeenCalled()
    expect(w.text()).toContain("A Database table's rows are kept with a saved model")
    w.unmount()
  })

  it('wait in the editor for the pending save, as the Worker checks rows against the stored model', async () => {
    const order: string[] = []
    let save!: () => void
    const ready = vi.fn(() => new Promise<boolean>((resolve) => (save = () => (order.push('saved'), resolve(true)))))
    const fetchJson = vi.fn<FetchJson>(async (url) => (order.push(url), []))
    const m = model(requests(), page(), inst('TableFeature', 't', { data_resource: '2' }))
    const Editor = defineComponent(() => {
      provide(PROXY_READY, ready)
      return () => h(DocumentView, { root: generate(m).root, modelId: 'm1', editing: true })
    })
    const w = mount(Editor, { global: { provide: { [FETCH_JSON as symbol]: fetchJson, [SEND_REQUEST as symbol]: vi.fn() } } })
    await flushPromises()
    expect(order).toEqual([])
    save()
    await flushPromises()
    expect(order).toEqual(['saved', '/api/v1/models/m1/tables/2/rows'])
    w.unmount()
  })
})

describe("a Table changing a row's status in place", () => {
  const rows = () => [
    { id: '01ARYZ6S410000000000000000', title: 'Fix the door', status: 'open' },
    { id: '01ARYZ6S410000000000000001', title: 'Order paper', status: 'later' },
  ]
  const tracker = () =>
    model(
      requests({ fields: ['title: text', 'status: choice open | done'] }),
      page(),
      inst('TableFeature', 't', { data_resource: '2', update_operation: 'PATCH rows' }),
    )

  it('shows a select per row, sends only the field changed, and keeps the rows on show while they reload', async () => {
    let answer = rows()
    let release!: () => void
    const fetchJson = vi.fn<FetchJson>(async () => answer)
    const send = vi.fn<SendRequest>(async () => {
      answer = [{ ...rows()[0]!, status: 'done' }, rows()[1]!]
      // The reload waits, to see what shows meanwhile.
      fetchJson.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(answer))))
      return {}
    })
    const { w } = render(tracker(), { fetchJson, send })
    await flushPromises()
    const select = w.get('select[aria-label="Status of “Fix the door”"]')
    expect((select.element as HTMLSelectElement).value).toBe('open')
    expect(select.findAll('option').map((o) => o.text())).toEqual(['open', 'done'])
    // A value the options don't hold shows, but can't be picked again.
    const other = w.get('select[aria-label="Status of “Order paper”"]')
    expect(other.findAll('option').map((o) => [o.text(), o.attributes('disabled') !== undefined])).toEqual([
      ['later', true],
      ['open', false],
      ['done', false],
    ])

    await select.setValue('done')
    await flushPromises()
    expect(send).toHaveBeenCalledWith({ method: 'PATCH', url: '/api/v1/models/m%201/tables/2/rows/01ARYZ6S410000000000000000', body: { status: 'done' } })
    expect(w.findAll('tbody tr')).toHaveLength(2)
    expect(w.find('.fd-table-skeleton').exists()).toBe(false)
    release()
    await flushPromises()
    expect((w.get('select[aria-label="Status of “Fix the door”"]').element as HTMLSelectElement).value).toBe('done')
    w.unmount()
  })

  it('changes several rows at once, each select showing what is stored once its change is done', async () => {
    const sent: unknown[] = []
    let finish: (() => void)[] = []
    const send = vi.fn<SendRequest>(async (request) => {
      sent.push(request.body)
      await new Promise<void>((resolve) => finish.push(resolve))
      return {}
    })
    // The server keeps "open" for the first row (say, a rule), and takes the second row's change.
    const fetchJson = vi.fn<FetchJson>(async () => (sent.length === 0 ? rows() : [rows()[0]!, { ...rows()[1]!, status: 'done' }]))
    const { w } = render(tracker(), { fetchJson, send })
    await flushPromises()
    const first = w.get('select[aria-label="Status of “Fix the door”"]')
    const second = w.get('select[aria-label="Status of “Order paper”"]')
    await first.setValue('done')
    await second.setValue('done')
    // The first cell again while it is still sending: put back, not sent.
    await first.setValue('open')
    expect((first.element as HTMLSelectElement).value).toBe('open')
    expect(sent).toEqual([{ status: 'done' }, { status: 'done' }])
    expect(first.attributes('aria-busy')).toBe('true')
    for (const done of finish) done()
    finish = []
    await flushPromises()
    expect((first.element as HTMLSelectElement).value).toBe('open')
    expect((second.element as HTMLSelectElement).value).toBe('done')
    expect(first.attributes('aria-busy')).toBeUndefined()
    w.unmount()
  })

  it('sends a number as a number, and names rows by number when their first column repeats', async () => {
    const send = vi.fn<SendRequest>(async () => ({}))
    const numbered = [
      { id: '01ARYZ6S410000000000000000', title: 'Same', level: 1 },
      { id: '01ARYZ6S410000000000000001', title: 'Same', level: 2 },
    ]
    const m = model(
      requests({ fields: ['title: text', 'level: choice 1 | 2 | 3'] }),
      page(),
      inst('TableFeature', 't', { data_resource: '2', update_operation: 'PATCH rows' }),
    )
    const { w } = render(m, { fetchJson: vi.fn<FetchJson>(async () => numbered), send })
    await flushPromises()
    expect(w.findAll('select').map((sel) => sel.attributes('aria-label'))).toEqual(['Level of row 1', 'Level of row 2'])
    await w.get('select[aria-label="Level of row 2"]').setValue('3')
    await flushPromises()
    expect(send.mock.lastCall![0].body).toEqual({ level: 3 })
    w.unmount()
  })

  it('puts a change back when it fails, saying why', async () => {
    const send = vi.fn<SendRequest>(async () => {
      throw new Error('The row is not valid: status must be one of open, done')
    })
    const { w } = render(tracker(), { fetchJson: vi.fn<FetchJson>(async () => rows()), send })
    await flushPromises()
    const select = w.get('select[aria-label="Status of “Fix the door”"]')
    await select.setValue('done')
    await flushPromises()
    expect((select.element as HTMLSelectElement).value).toBe('open')
    expect(w.get('[role="alert"]').text()).toBe("Couldn't change the row: The row is not valid: status must be one of open, done")
    w.unmount()
  })

  it('changes nothing from the editor canvas, and says so', async () => {
    const send = vi.fn<SendRequest>()
    const w = mount(DocumentView, {
      props: { root: generate(tracker()).root, modelId: 'm', editing: true },
      global: { provide: { [FETCH_JSON as symbol]: vi.fn<FetchJson>(async () => rows()), [SEND_REQUEST as symbol]: send } },
      attachTo: document.body,
    })
    await flushPromises()
    const select = w.get('select[aria-label="Status of “Fix the door”"]')
    await select.setValue('done')
    await flushPromises()
    expect(send).not.toHaveBeenCalled()
    expect((select.element as HTMLSelectElement).value).toBe('open')
    expect(w.get('[role="alert"]').text()).toBe('Nothing is changed from the editor. Open the preview to try it.')
    w.unmount()
  })
})

describe('sending to a Database table', () => {
  it("doesn't change sample rows in place", async () => {
    const store = new DataStore(async () => [], 'm1')
    await expect(
      store.update({ feature: 's', resource: 'S', operation: 'PATCH', method: 'PATCH', endPoint: '', sample: true }, { id: 1 }, { status: 'done' }),
    ).rejects.toThrow("Sample rows can't be changed in place")
  })

  it('refuses query values, which its rows take none of, rather than send them elsewhere', async () => {
    const send = vi.fn<SendRequest>()
    const store = new DataStore(async () => [], 'm1', undefined, send)
    const action = { feature: '2', resource: 'Requests', operation: 'POST rows', method: 'POST', endPoint: 'tables/2/rows' }
    await expect(store.send(action, { q: 'x' }, [{ name: 'q', label: 'Q', type: 'text', required: false, in: 'query' }])).rejects.toThrow(
      `"tables/2/rows?q=x" isn't a Database table's rows`,
    )
    expect(send).not.toHaveBeenCalled()
  })
})

describe('the browser fetchers', () => {
  afterEach(() => vi.unstubAllGlobals())

  it("reach a model's rows on this site with the viewer's session, and refuse a rows address that isn't one", async () => {
    const fetchSpy = vi.fn(async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchSpy)
    expect(await browserFetchJson('/api/v1/models/m1/tables/2/rows')).toEqual([])
    const init = (fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(init.redirect).toBe('manual')
    expect(init.credentials).toBeUndefined()
    await browserSendRequest({ method: 'POST', url: '/api/v1/models/m1/tables/2/rows', body: { title: 'x' } })
    expect(fetchSpy).toHaveBeenLastCalledWith('/api/v1/models/m1/tables/2/rows', expect.objectContaining({ method: 'POST', body: '{"title":"x"}' }))
    await expect(browserFetchJson('tables/2/rows')).rejects.toThrow('Only http(s) URLs can be loaded')
    await expect(browserFetchJson('/api/v1/models/m1/tables/2/rows/../../x')).rejects.toThrow('Only http(s) URLs can be loaded')
    await expect(browserSendRequest({ method: 'POST', url: '/api/v1/proxy/tables/2/rows' })).rejects.toThrow('Only http(s) URLs can be sent to')
  })
})

describe('a Form on a Database table', () => {
  it("has a control per kind of field, starting at the field's default, and sends typed values to the model's rows", async () => {
    const send = vi.fn<SendRequest>(async () => ({ id: '01ARYZ6S410000000000000000' }))
    const { w } = render(model(requests(), page(), inst('FormFeature', 'f', { data_resource: '2' })), { send })
    await flushPromises()
    // A field named "title" is labeled, though the form's own title would have had the same id.
    expect(labeled(w, 'Title').element.tagName).toBe('INPUT')
    expect(labeled(w, 'Notes').element.tagName).toBe('TEXTAREA')
    const priority = labeled(w, 'Priority')
    expect(priority.element.tagName).toBe('SELECT')
    expect((priority.element as HTMLSelectElement).value).toBe('normal')
    expect(priority.findAll('option').map((o) => o.text())).toEqual(['—', 'low', 'normal', 'urgent'])
    expect(labeled(w, 'Due').attributes('type')).toBe('date')
    expect(labeled(w, 'Done').attributes('type')).toBe('checkbox')

    await labeled(w, 'Title').setValue('Order toner')
    await labeled(w, 'Notes').setValue('Two packs')
    await priority.setValue('urgent')
    await labeled(w, 'Due').setValue('2026-11-03')
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(send).toHaveBeenCalledWith({
      method: 'POST',
      url: '/api/v1/models/m%201/tables/2/rows',
      // The checkbox wasn't changed from what it started at, so it isn't sent.
      body: { title: 'Order toner', notes: 'Two packs', priority: 'urgent', due: '2026-11-03' },
    })
    // Back to the defaults for the next one.
    expect((priority.element as HTMLSelectElement).value).toBe('normal')
    expect((labeled(w, 'Title').element as HTMLInputElement).value).toBe('')
    w.unmount()
  })

  it('sends a checkbox only when changed from what it started at, so a form changing a row leaves the others be', async () => {
    const send = vi.fn<SendRequest>(async () => ({}))
    const fields = ['title: text', 'done: yes/no', 'billed: yes/no, default yes']
    const { w } = render(
      model(requests({ fields }), page(), inst('FormFeature', 'f', { data_resource: '2', operation: 'PATCH rows', fields: ['id', 'title', 'done', 'billed'] })),
      {
        send,
      },
    )
    await flushPromises()
    await labeled(w, 'Id').setValue('01ARYZ6S410000000000000000')
    await labeled(w, 'Title').setValue('Renamed')
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(send).toHaveBeenLastCalledWith({
      method: 'PATCH',
      url: '/api/v1/models/m%201/tables/2/rows/01ARYZ6S410000000000000000',
      body: { id: '01ARYZ6S410000000000000000', title: 'Renamed' },
    })
    await labeled(w, 'Id').setValue('01ARYZ6S410000000000000000')
    await labeled(w, 'Done').setValue(true)
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(send.mock.lastCall![0].body).toEqual({ id: '01ARYZ6S410000000000000000', done: true })
    w.unmount()

    // A new row: a box that starts checked (its default) and is unchecked is sent as no.
    const added = render(model(requests({ fields }), page(), inst('FormFeature', 'f', { data_resource: '2' })), { send })
    await flushPromises()
    await labeled(added.w, 'Title').setValue('New')
    await labeled(added.w, 'Billed').setValue(false)
    await added.w.get('form').trigger('submit')
    await flushPromises()
    expect(send.mock.lastCall![0].body).toEqual({ title: 'New', billed: false })
    added.w.unmount()
  })

  it('starts a field over when what it takes changes', async () => {
    const m = (fields: string[]) => generate(model(requests({ fields }), page(), inst('FormFeature', 'f', { data_resource: '2' }))).root
    const w = mount(DocumentView, { props: { root: m(['title: text', 'done: yes/no']), modelId: 'm' }, attachTo: document.body })
    await flushPromises()
    await labeled(w, 'Done').setValue(true)
    await labeled(w, 'Title').setValue('Kept')
    await w.setProps({ root: m(['title: text', 'done: text']) })
    await flushPromises()
    expect((labeled(w, 'Done').element as HTMLInputElement).value).toBe('')
    expect((labeled(w, 'Title').element as HTMLInputElement).value).toBe('Kept')
    w.unmount()
  })

  it("doesn't count a checkbox as filling in the form", async () => {
    const send = vi.fn<SendRequest>(async () => ({}))
    const { w } = render(model(requests({ fields: ['title: text', 'done: yes/no'] }), page(), inst('FormFeature', 'f', { data_resource: '2' })), { send })
    await flushPromises()
    await labeled(w, 'Done').setValue(true)
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(send).not.toHaveBeenCalled()
    expect(w.get('[role="alert"]').text()).toBe('Fill in the form before sending.')
    w.unmount()
  })
})

describe('TableFieldsField', () => {
  const field = (value: string[]) => mount(TableFieldsField, { props: { id: 'fields', labelledby: 'fields-label', value } })
  const lastChange = (w: ReturnType<typeof field>) => w.emitted('change')!.at(-1)![0]

  it('shows a card per field, and writes a change back as the line the engine reads', async () => {
    const w = field(FIELDS)
    expect(w.findAll('li').map((li) => li.attributes('data-field'))).toEqual(['title', 'notes', 'priority', 'due', 'done'])
    await w.get('select[aria-label="Type of notes"]').setValue('number')
    expect(lastChange(w)).toEqual([FIELDS[0], 'notes: number', ...FIELDS.slice(2)])
    await w.get('li[data-field="title"] input[type="checkbox"]').setValue(false)
    expect((lastChange(w) as string[])[0]).toBe('title: text')
  })

  it("says what is wrong instead of storing a line the engine can't read", async () => {
    const w = field(FIELDS)
    const name = w.get('input[aria-label="Name of field 2"]')
    await name.setValue('notes on it')
    expect(w.emitted('change')).toBeUndefined()
    expect(w.get('[role="alert"]').text()).toContain("can't be a field name")
    await name.setValue('title')
    expect(w.get('[role="alert"]').text()).toBe('Another field is called "title"')
    await w.get('select[aria-label="Type of notes"]').setValue('number')
    await w.setProps({ value: lastChange(w) as string[] })
    await w.get('input[aria-label="Default of notes"]').setValue('many')
    expect(w.findAll('[role="alert"]').map((a) => a.text())).toContain('The default must be a number')
    expect((w.get('input[aria-label="Default of notes"]').element as HTMLInputElement).value).toBe('')
  })

  it('adds, moves and removes fields, keeps options with commas, and edits the lines as text', async () => {
    const w = field(['a: text'])
    await w
      .findAll('button')
      .find((b) => b.text() === 'Add field')!
      .trigger('click')
    expect(lastChange(w)).toEqual(['a: text', 'field_2: text'])
    await w.setProps({ value: ['a: text', 'size: choice s | m'] })
    await w.get('input[aria-label="Options of size, separated by |"]').setValue('Small, cheap | Large')
    expect(lastChange(w)).toEqual(['a: text', 'size: choice "Small, cheap" | Large'])
    await w.get('button[aria-label="Move size up"]').trigger('click')
    expect(lastChange(w)).toEqual(['size: choice s | m', 'a: text'])
    await w.get('button[aria-label="Remove a"]').trigger('click')
    expect(lastChange(w)).toEqual(['size: choice s | m'])
    await w
      .findAll('button')
      .find((b) => b.text() === 'Edit as text')!
      .trigger('click')
    await w.get('textarea').setValue('a: text\n\nb: date')
    expect(lastChange(w)).toEqual(['a: text', 'b: date'])
  })

  it('keeps the text as typed, spaces included, and stays text while a broken line is fixed', async () => {
    const w = field(['a: text', 'b: choice'])
    const text = w.get('textarea')
    await text.setValue('a: text\nb: choice l ')
    // The model holds the lines trimmed, and the line now reads: the text box stays, as typed.
    await w.setProps({ value: lastChange(w) as string[] })
    expect(lastChange(w)).toEqual(['a: text', 'b: choice l'])
    expect((w.get('textarea').element as HTMLTextAreaElement).value).toBe('a: text\nb: choice l ')
    await w.get('textarea').trigger('blur')
    expect((w.get('textarea').element as HTMLTextAreaElement).value).toBe('a: text\nb: choice l')
    await w
      .findAll('button')
      .find((b) => b.text() === 'Edit as fields')!
      .trigger('click')
    expect(w.findAll('li')).toHaveLength(2)
  })

  it('puts a refused name back, saying why, until the lines change elsewhere', async () => {
    const w = field(['a: text', 'b: text'])
    const name = w.get('input[aria-label="Name of field 1"]')
    await name.setValue('b')
    expect(w.emitted('change')).toBeUndefined()
    expect((name.element as HTMLInputElement).value).toBe('a')
    expect(w.get('[role="alert"]').text()).toBe('Another field is called "b"')
    // A change to another field here keeps the message.
    await w.get('select[aria-label="Type of b"]').setValue('date')
    await w.setProps({ value: lastChange(w) as string[] })
    expect(w.get('[role="alert"]').text()).toBe('Another field is called "b"')
    // Undo, or another table: the message goes.
    await w.setProps({ value: ['a: text', 'b: number'] })
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })

  it("doesn't carry a yes/no default into another type", async () => {
    const w = field(['done: yes/no, default yes', 'n: number, default 3'])
    await w.get('select[aria-label="Type of done"]').setValue('text')
    expect(lastChange(w)).toEqual(['done: text', 'n: number, default 3'])
    await w.get('select[aria-label="Type of n"]').setValue('text')
    expect(lastChange(w)).toEqual(['done: yes/no, default yes', 'n: text, default 3'])
  })

  it("shows lines it can't read as text, to be fixed there", () => {
    const w = field(['a: text', 'b: huge'])
    expect(w.findAll('li')).toHaveLength(0)
    expect(w.text()).toContain("Some lines can't be shown as fields")
    expect((w.get('textarea').element as HTMLTextAreaElement).value).toBe('a: text\nb: huge')
  })
})
