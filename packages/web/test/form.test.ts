import { generate, type AppModel } from '@feature-domain/engine'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { DataStore, fillPath, NotSentFromEditor } from '../src/renderer/data'
import DocumentView from '../src/renderer/DocumentView.vue'
import { FETCH_JSON, requestInit, SEND_REQUEST, type FetchJson, type SendRequest } from '../src/renderer/rows'
import { inst, MemoryStorage, model, page } from './helpers'

const render = (m: AppModel, fetchJson: FetchJson = async () => [], sendRequest: SendRequest = async () => undefined, editing = false) =>
  mount(DocumentView, { props: { root: generate(m).root, editing }, global: { provide: { [FETCH_JSON as symbol]: fetchJson, [SEND_REQUEST as symbol]: sendRequest } }, attachTo: document.body })

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

  it('moves keyboard focus with the delete buttons: to the question, back after Keep, on after deleting', async () => {
    const w = render(model(people, page(), inst('FormFeature', 'f', { data_resource: 'r' }), inst('TableFeature', 't', { data_resource: 'r', delete_operation: 'DELETE rows' })))
    await flushPromises()
    for (const name of ['Grace', 'Alan']) {
      await fill(w, { Name: name })
      await w.get('form').trigger('submit')
      await flushPromises()
    }
    const focused = () => document.activeElement as HTMLElement
    await w.get('[data-delete-row="1"]').trigger('click')
    await flushPromises()
    expect(focused().textContent).toBe('Delete')
    expect(focused().classList.contains('fd-table-action-danger')).toBe(true)
    await w.findAll('.fd-table-action').find((b) => b.text() === 'Keep')!.trigger('click')
    await flushPromises()
    expect(focused().getAttribute('data-delete-row')).toBe('1')
    // Deleting Grace: Alan's row moves up, and focus goes to its Delete button.
    await w.get('[data-delete-row="1"]').trigger('click')
    await w.get('.fd-table-action-danger').trigger('click')
    await flushPromises()
    expect(focused().getAttribute('aria-label')).toBe('Delete row 2')
    expect(w.findAll('tbody tr').map((tr) => tr.find('td').text())).toEqual(['Ada', 'Alan'])
    // Deleting the last deletable row: focus goes to the table itself.
    await w.get('[data-delete-row="1"]').trigger('click')
    await w.get('.fd-table-action-danger').trigger('click')
    await flushPromises()
    expect(focused().classList.contains('fd-table-block')).toBe(true)
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
    expect(send).toHaveBeenCalledWith({ method: 'POST', url: 'https://pets.test/owners/tom%20smith/pets?notify=yes', body: { name: 'Rex', age: 4 }, requestType: 'form' })
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

  it('sends nothing from the editor, saying where it would have gone; sample data still changes there', async () => {
    const send = vi.fn<SendRequest>(async () => undefined)
    const w = render(model(pets, people, page(), inst('FormFeature', 'f', { data_resource: 's' }), inst('FormFeature', 'g', { data_resource: 'r' }), inst('TableFeature', 't', { data_resource: 'r' })), async () => [], send, true)
    await flushPromises()
    const [address, sample] = w.findAll('form')
    await fill(w, { Owner: 'tom' })
    await address!.trigger('submit')
    await flushPromises()
    expect(send).not.toHaveBeenCalled()
    expect(address!.get('[role="alert"]').text()).toBe('Nothing is sent from the editor (this would go to pets.test). Open the preview to try it.')
    await sample!.get('input[name="name"]').setValue('Grace')
    await sample!.trigger('submit')
    await flushPromises()
    expect(w.findAll('tbody tr')).toHaveLength(2)
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

  it('fills placeholders from own values only, never with "." or ".." (which would move the address up)', () => {
    expect(fillPath('https://x.test/{a}/{b}', { a: 1, b: 'x y' })).toBe('https://x.test/1/x%20y')
    expect(() => fillPath('https://x.test/{constructor}', {})).toThrow('No value for "constructor"')
    expect(() => fillPath('https://x.test/sales/{id}', { id: '..' })).toThrow('".." can\'t fill "id" in the address')
    expect(() => fillPath('https://x.test/sales/{id}', { id: '.' })).toThrow('"." can\'t fill "id" in the address')
    expect(fillPath('https://x.test/sales/{id}', { id: '../x' })).toBe('https://x.test/sales/..%2Fx')
    expect(fillPath('https://x.test/sales/{id}', { id: '...' })).toBe('https://x.test/sales/...')
  })

  it('never reuses the id of a deleted sample row, in this page or the next', async () => {
    const storage = new MemoryStorage()
    const action = { feature: 's', resource: 'Sales', operation: 'POST rows', method: 'POST', endPoint: '', sample: true as const, sampleIds: { field: 'id', after: 5, text: false } }
    const del = { ...action, operation: 'DELETE rows', method: 'DELETE', sampleIds: undefined }
    const store = new DataStore(async () => [], 'm1', storage)
    const rows = (s: DataStore) => (s.rows({ value: { feature: 's', resource: 'Sales', operation: 'GET', endPoint: '', rows: [] } } as never).value as { rows: { id: number }[] }).rows
    await store.send(action, { name: 'Bob' }, [])
    await store.delete(del, rows(store)[0])
    await store.send(action, { name: 'Ann' }, [])
    expect(rows(store).map((r) => r.id)).toEqual([7])
    await store.delete(del, rows(store)[0])
    // A new page load remembers the last id given, though no added row is left.
    const next = new DataStore(async () => [], 'm1', storage)
    await next.send(action, { name: 'Cy' }, [])
    expect(rows(next).map((r) => r.id)).toEqual([8])
  })

  it('sends a multipart body as form data, a form-encoded one as URL parameters, else JSON', () => {
    const body = { name: 'Rex', age: 4 }
    const multipart = requestInit({ method: 'POST', url: 'https://x.test', body, requestType: 'multipart' }).body as FormData
    expect(multipart).toBeInstanceOf(FormData)
    expect([...multipart.entries()]).toEqual([['name', 'Rex'], ['age', '4']])
    expect(String(requestInit({ method: 'POST', url: 'https://x.test', body, requestType: 'form' }).body)).toBe('name=Rex&age=4')
    expect(requestInit({ method: 'POST', url: 'https://x.test', body })).toMatchObject({ headers: { 'Content-Type': 'application/json' }, body: '{"name":"Rex","age":4}' })
  })

  it('refuses to send or delete at an address from the editor', async () => {
    const send = vi.fn<SendRequest>(async () => undefined)
    const store = new DataStore(async () => [], undefined, undefined, send, false)
    const action = { feature: 'r', resource: 'Repos', operation: 'DELETE /repos/{id}', method: 'DELETE', endPoint: 'https://x.test/repos/{id}' }
    await expect(store.delete(action, { id: 1 })).rejects.toBeInstanceOf(NotSentFromEditor)
    await expect(store.send({ ...action, method: 'POST' }, { id: 1 }, [])).rejects.toThrow('Nothing is sent from the editor (this would go to x.test)')
    expect(send).not.toHaveBeenCalled()
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

describe('Tables on an address', () => {
  const repos = inst('DataResourceFeature', 'g', { name: 'Repos', resource: 'https://x.test/repos' }, null)
  const spec = { openapi: '3.0.0', servers: [{ url: 'https://x.test' }], paths: { '/repos': { get: {} }, '/repos/{id}': { delete: {} } } }

  it('apply their Labels and Filters to the columns the loaded rows give, in order', async () => {
    const w = render(model(repos, page(), inst('TableFeature', 't', { data_resource: 'g', labels: ['Who'], filters: ['', 'currency'] })), async () => [{ name: 'Ada', amount: 15000 }])
    await flushPromises()
    expect(w.findAll('th').map((th) => th.text())).toEqual(['Who', 'Amount'])
    expect(w.findAll('tbody td').map((td) => td.text())).toEqual(['Ada', '$15,000.00'])
    w.unmount()
  })

  it('keep the delete column while rows reload, and drop an old delete problem on the next choice', async () => {
    let resolveRows: (rows: unknown[]) => void = () => {}
    const fetchJson = vi.fn<FetchJson>(() => new Promise((resolve) => (resolveRows = resolve)))
    const send = vi.fn<SendRequest>(async () => {
      throw new Error('500 Server Error')
    })
    const w = render(model(inst('SwaggerDataResourceFeature', 's', { spec: JSON.stringify(spec) }, null), page(), inst('TableFeature', 't', { data_resource: 's', delete_operation: 'DELETE /repos/{id}' })), fetchJson, send)
    await flushPromises()
    // Loading: the column is there already, its skeleton cell too.
    expect(w.find('th.fd-table-actions').exists()).toBe(true)
    expect(w.find('.fd-table-skeleton td.fd-table-actions').exists()).toBe(true)
    resolveRows([{ id: 1 }, { id: 2 }])
    await flushPromises()
    await w.get('[data-delete-row="0"]').trigger('click')
    await w.get('.fd-table-action-danger').trigger('click')
    await flushPromises()
    expect(w.get('.fd-table-delete-problem').text()).toBe("Couldn't delete the row: 500 Server Error")
    await w.findAll('.fd-table-action').find((b) => b.text() === 'Keep')!.trigger('click')
    expect(w.find('.fd-table-delete-problem').exists()).toBe(false)
    w.unmount()
  })

  it('delete nothing from the editor, and say so', async () => {
    const send = vi.fn<SendRequest>(async () => undefined)
    const w = render(model(inst('SwaggerDataResourceFeature', 's', { spec: JSON.stringify(spec) }, null), page(), inst('TableFeature', 't', { data_resource: 's', delete_operation: 'DELETE /repos/{id}' })), async () => [{ id: 1 }], send, true)
    await flushPromises()
    await w.get('[data-delete-row="0"]').trigger('click')
    await w.get('.fd-table-action-danger').trigger('click')
    await flushPromises()
    expect(send).not.toHaveBeenCalled()
    expect(w.get('.fd-table-delete-problem').text()).toBe('Nothing is deleted from the editor (this would go to x.test). Open the preview to try it.')
    w.unmount()
  })
})
