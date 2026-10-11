import { MemoryModelStore, type AppModel } from '@feature-domain/engine'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ApiSpecField from '../src/editor/ApiSpecField.vue'
import Inspector from '../src/editor/Inspector.vue'
import { FETCH_JSON, type FetchJson } from '../src/renderer/rows'
import { setModelStore } from '../src/services'
import { useDocumentStore } from '../src/stores/document'
import { inst, model, page } from './helpers'

const pets = {
  openapi: '3.1.0',
  info: { title: 'Pets' },
  servers: [{ url: 'https://pets.test' }],
  components: { schemas: { Pet: { type: 'object', properties: { name: { type: 'string' } } } } },
  paths: {
    '/pets': {
      get: { summary: 'List pets', responses: { '200': { content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } } } } } } },
      post: { responses: { '201': {} } },
    },
    '/pets/{id}': { delete: { responses: { '200': {} } } },
  },
}

const field = (props: { value?: string; specUrl?: string }, fetchJson: FetchJson = async () => pets) =>
  mount(ApiSpecField, { props: { id: 'spec', value: props.value ?? '', specUrl: props.specUrl ?? '' }, global: { provide: { [FETCH_JSON as symbol]: fetchJson } } })

describe('ApiSpecField', () => {
  it('summarises the stored spec, or says none is loaded', () => {
    expect(field({}).get('[data-testid="api-spec-summary"]').text()).toBe('No spec loaded yet.')
    expect(field({ value: JSON.stringify(pets) }).get('[data-testid="api-spec-summary"]').text()).toBe('OpenAPI 3.1.0 · Pets · 3 operations')
    expect(field({ value: '{"swagger": "2.0"}' }).get('[data-testid="api-spec-summary"]').text()).toBe('Only OpenAPI 3 specs are read; convert this Swagger spec to OpenAPI 3 first.')
  })

  it('loads the spec from its URL into the stored spec, and explains a failure', async () => {
    const fetchJson = vi.fn<FetchJson>(async () => pets)
    const w = field({ specUrl: 'https://pets.test/openapi.json' }, fetchJson)
    await w.get('[data-testid="load-spec"]').trigger('click')
    await flushPromises()
    expect(fetchJson).toHaveBeenCalledWith('https://pets.test/openapi.json')
    expect(JSON.parse(w.emitted('change')![0]![0] as string)).toEqual(pets)

    const failing = field({ specUrl: 'https://pets.test/openapi.json' }, async () => {
      throw new Error('Failed to fetch')
    })
    await failing.get('[data-testid="load-spec"]').trigger('click')
    await flushPromises()
    expect(failing.get('[data-testid="api-spec-problem"]').text()).toContain("Couldn't load the spec from pets.test (Failed to fetch)")
    expect(failing.emitted('change')).toBeUndefined()

    const swagger = field({ specUrl: 'https://old.test/swagger.json' }, async () => ({ swagger: '2.0' }))
    await swagger.get('[data-testid="load-spec"]').trigger('click')
    await flushPromises()
    expect(swagger.get('[data-testid="api-spec-problem"]').text()).toContain('Only OpenAPI 3 specs are read')
    expect(swagger.emitted('change')).toBeUndefined()
  })

  it('only loads http(s) addresses, and takes a pasted spec', async () => {
    const w = field({ specUrl: 'file:///etc/passwd' })
    expect(w.get('[data-testid="load-spec"]').attributes('disabled')).toBeDefined()
    await w.get('textarea').setValue('{"openapi": "3.0.0"}')
    expect(w.emitted('change')![0]).toEqual(['{"openapi": "3.0.0"}'])
  })
})

describe('Operation pickers in the inspector', () => {
  beforeEach(() => setActivePinia(createPinia()))

  async function inspect(m: AppModel, selected: string) {
    const store = new MemoryModelStore()
    setModelStore(store)
    const doc = useDocumentStore()
    doc.editing = true
    await doc.load(await store.create(m))
    doc.select(selected)
    return { doc, w: mount(Inspector) }
  }

  it("offers a table the referenced resource's operations, only those with fitting methods", async () => {
    const { doc, w } = await inspect(model(inst('SwaggerDataResourceFeature', 's', { name: 'Pets', spec: JSON.stringify(pets) }, null), page(), inst('TableFeature', 't', { data_resource: 's' })), 't')
    const options = (name: string) => w.get(`#input-${name}`).findAll('option').map((o) => o.text())
    expect(options('operation')).toEqual(['First (GET /pets)', 'GET /pets · List pets'])
    expect(options('delete_operation')).toEqual(['None', 'DELETE /pets/{id}'])
    await w.get('#input-operation').setValue('GET /pets')
    expect(doc.model!.features.find((f) => f.id === 't')!.inputs.operation).toBe('GET /pets')
  })

  it('keeps a stored operation the resource no longer has visible, and offers nothing without a resource', async () => {
    const { w } = await inspect(model(page(), inst('TableFeature', 't', { operation: 'GET /gone' })), 't')
    expect(w.get('#input-operation').findAll('option').map((o) => o.text())).toEqual(['Unknown: GET /gone', 'None available'])
  })
})
