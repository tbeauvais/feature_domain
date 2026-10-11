import { generate, type AppModel } from '@feature-domain/engine'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { DataStore, fillPath } from '../src/renderer/data'
import DocumentView from '../src/renderer/DocumentView.vue'
import { FETCH_JSON, SEND_REQUEST, type FetchJson, type SendRequest } from '../src/renderer/rows'
import { inst, MemoryStorage, model, page } from './helpers'

const render = (m: AppModel, fetchJson: FetchJson = async () => [], sendRequest: SendRequest = async () => undefined) =>
  mount(DocumentView, { props: { root: generate(m).root }, global: { provide: { [FETCH_JSON as symbol]: fetchJson, [SEND_REQUEST as symbol]: sendRequest } }, attachTo: document.body })

const people = inst('DataResourceFeature', 'r', { name: 'People', source: 'sample', sample_rows: '[{"name": "Ada", "projects": 3}]' }, null)
const fill = async (w: ReturnType<typeof render>, values: Record<string, string>) => {
  for (const [label, value] of Object.entries(values)) {
    const id = w.findAll('label').find((l) => l.text().replace(' *', '') === label)!.attributes('for')
    await w.get(`#${id}`).setValue(value)
  }
}

describe('Form on sample data', () => {
  it('adds a row that the table on the same resource shows at once, with numbers as numbers', async () => {
    const w = render(model(people, page(), inst('FormFeature', 'f', { data_resource: 'r' }), inst('TableFeature', 't', { data_resource: 'r', delete_operation: 'DELETE rows' })))
    await flushPromises()
    expect(w.findAll('.fd-form-label').map((l) => l.text())).toEqual(['Name', 'Projects'])
    // Nothing added yet, so nothing can be deleted: no delete column.
    expect(w.find('th.fd-table-actions').exists()).toBe(false)
    expect(w.get('.fd-form-field input[name="projects"]').attributes('type')).toBe('number')
    await fill(w, { Name: 'Grace', Projects: '9' })
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(w.get('.fd-form-sent').text()).toBe('Thanks, that was sent.')
    expect(w.findAll('tbody tr').map((tr) => tr.findAll('td').slice(0, 2).map((td) => td.text()))).toEqual([
      ['Ada', '3'],
      ['Grace', '9'],
    ])
    // The fields are cleared for the next entry.
    expect((w.get('input[name="name"]').element as HTMLInputElement).value).toBe('')

    // Only the added row can be deleted (the model's own rows are the sample), after saying so.
    const rows = w.findAll('tbody tr')
    expect(rows[0]!.find('.fd-table-action').exists()).toBe(false)
    await rows[1]!.get('.fd-table-action').trigger('click')
    expect(rows[1]!.get('.fd-table-confirm').text()).toContain('Delete this row?')
    await rows[1]!.findAll('.fd-table-action').find((b) => b.text() === 'Keep')!.trigger('click')
    expect(w.findAll('tbody tr')).toHaveLength(2)
    await w.findAll('tbody tr')[1]!.get('.fd-table-action').trigger('click')
    await w.findAll('tbody tr')[1]!.get('.fd-table-action-danger').trigger('click')
    await flushPromises()
    expect(w.findAll('tbody tr')).toHaveLength(1)
    w.unmount()
  })

  it('never sends a form with every field empty', async () => {
    const w = render(model(people, page(), inst('FormFeature', 'f', { data_resource: 'r' }), inst('TableFeature', 't', { data_resource: 'r' })))
    await flushPromises()
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(w.get('.fd-form-error').text()).toBe('Fill in the form before sending.')
    expect(w.findAll('tbody tr')).toHaveLength(1)
    w.unmount()
  })

  it('checks required fields and numbers before sending', async () => {
    const spec = { openapi: '3.0.0', servers: [{ url: 'https://pets.test' }], paths: { '/pets/{id}': { put: { parameters: [{ name: 'id', in: 'path', required: true }], requestBody: { content: { 'application/json': { schema: { properties: { age: { type: 'integer' } } } } } } } } } }
    const send = vi.fn<SendRequest>(async () => undefined)
    const w = render(model(inst('SwaggerDataResourceFeature', 's', { spec: JSON.stringify(spec) }, null), page(), inst('FormFeature', 'f', { data_resource: 's' })), async () => [], send)
    await flushPromises()
    await w.get('form').trigger('submit')
    expect(w.get('.fd-form-error').text()).toBe('Id is required.')
    expect(send).not.toHaveBeenCalled()
    w.unmount()
  })
})

describe('Form on an address', () => {
  const spec = {
    openapi: '3.0.0',
    servers: [{ url: 'https://pets.test' }],
    paths: {
      '/owners/{owner}/pets': {
        get: {},
        post: {
          parameters: [{ name: 'owner', in: 'path', required: true }, { name: 'notify', in: 'query' }],
          requestBody: { content: { 'application/x-www-form-urlencoded': { schema: { properties: { name: { type: 'string' }, age: { type: 'integer' } } } } } },
        },
      },
    },
  }
  const pets = inst('SwaggerDataResourceFeature', 's', { name: 'Pets', spec: JSON.stringify(spec) }, null)

  it('fills path placeholders, adds query values, sends the rest form-encoded, then reloads the resource\'s tables', async () => {
    const send = vi.fn<SendRequest>(async () => ({ ok: true }))
    const fetchJson = vi.fn<FetchJson>(async () => [])
    const w = render(model(pets, page(), inst('FormFeature', 'f', { data_resource: 's' }), inst('TableFeature', 't', { data_resource: 's', operation: 'GET /owners/{owner}/pets' })), fetchJson, send)
    await flushPromises()
    const fetchedBefore = fetchJson.mock.calls.length
    await fill(w, { Owner: 'tom smith', Notify: 'yes', Name: 'Rex', Age: '4' })
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(send).toHaveBeenCalledWith({ method: 'POST', url: 'https://pets.test/owners/tom%20smith/pets?notify=yes', body: { name: 'Rex', age: 4 }, form: true })
    expect(fetchJson.mock.calls.length).toBe(fetchedBefore + 1)
    w.unmount()
  })

  it('says what went wrong, naming the site', async () => {
    const w = render(model(pets, page(), inst('FormFeature', 'f', { data_resource: 's' })), async () => [], async () => {
      throw new Error('500 Server Error')
    })
    await flushPromises()
    await fill(w, { Owner: 'tom' })
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toBe('pets.test: 500 Server Error')
    w.unmount()
  })

  it('has nothing to send to without a POST or PUT operation, and says so', async () => {
    const feed = inst('DataResourceFeature', 'g', { name: 'Feed', resource: 'https://x.test/feed' }, null)
    const w = render(model(feed, page(), inst('FormFeature', 'f', { data_resource: 'g', fields: ['email'] })))
    await flushPromises()
    expect(w.get('.fd-form-note').text()).toContain('Nothing to send to yet')
    expect(w.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    w.unmount()
  })
})

describe('DataStore changes', () => {
  it('gives a row added to sample data the next id, as a server would', async () => {
    const store = new DataStore(async () => [])
    const action = { feature: 's', resource: 'Sales', operation: 'POST /sales', method: 'POST', endPoint: '', sample: true as const, sampleIds: { field: 'id', after: 5, text: true } }
    await store.send(action, { name: 'Bob' }, [])
    await store.send(action, { name: 'Ann' }, [])
    // An id given in the form is kept.
    await store.send(action, { id: '42', name: 'Cy' }, [])
    const rows = store.rows({ value: { feature: 's', resource: 'Sales', operation: 'GET', endPoint: '', rows: [] } } as never).value
    expect(rows).toEqual({ status: 'loaded', rows: [{ id: '6', name: 'Bob' }, { id: '7', name: 'Ann' }, { id: '42', name: 'Cy' }] })
  })

  it('deletes a fetched row at its address, filled from the row, then reloads', async () => {
    const send = vi.fn<SendRequest>(async () => undefined)
    const store = new DataStore(async () => [], undefined, undefined, send)
    const action = { feature: 'r', resource: 'Repos', operation: 'DELETE /repos/{id}', method: 'DELETE', endPoint: 'https://x.test/repos/{id}' }
    expect(store.canDelete(action, { id: 1 })).toBe(true)
    await store.delete(action, { id: 'a/b' })
    expect(send).toHaveBeenCalledWith({ method: 'DELETE', url: 'https://x.test/repos/a%2Fb' })
    await expect(store.delete(action, { name: 'no id' })).rejects.toThrow('No value for "id" to fill the address')
  })

  it('fills placeholders from own values only', () => {
    expect(fillPath('https://x.test/{a}/{b}', { a: 1, b: 'x y' })).toBe('https://x.test/1/x%20y')
    expect(() => fillPath('https://x.test/{constructor}', {})).toThrow('No value for "constructor"')
  })

  it('follows rows added in another tab', () => {
    const storage = new MemoryStorage()
    const store = new DataStore(async () => [], 'm1', storage)
    const stop = store.follow()
    storage.setItem('feature-domain:sample-rows:m1', JSON.stringify({ r: [{ name: 'From the editor' }] }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'feature-domain:sample-rows:m1' }))
    expect(store.addedRows('r')).toBe(1)
    stop()
    storage.setItem('feature-domain:sample-rows:m1', JSON.stringify({ r: [] }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'feature-domain:sample-rows:m1' }))
    expect(store.addedRows('r')).toBe(1)
  })
})
