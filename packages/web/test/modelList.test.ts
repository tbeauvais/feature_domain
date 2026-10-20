import { MemoryModelStore } from '@feature-domain/engine'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { setModelStore } from '../src/services'
import { HOME_ID, SignedOutError } from '../src/stores/apiModelStore'
import ModelListView from '../src/views/ModelListView.vue'

function list(store: MemoryModelStore) {
  setModelStore(store)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: ModelListView },
      { path: '/models/:id', name: 'model', component: ModelListView },
    ],
  })
  return { router, w: mount(ModelListView, { global: { plugins: [router] } }) }
}

describe('the model list over the network', () => {
  afterEach(() => vi.restoreAllMocks())

  it('says why the models could not be loaded, and tries again', async () => {
    const store = new MemoryModelStore()
    await store.create({ version: 2, name: 'Mine', features: [] })
    vi.spyOn(store, 'list').mockRejectedValueOnce(new SignedOutError())
    const { w } = list(store)
    await flushPromises()
    expect(w.get('[data-testid="list-error"]').text()).toContain('Could not load the models: your sign-in has expired; reload the page to sign in again.')
    await w.get('[data-testid="list-error"] button').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="list-error"]').exists()).toBe(false)
    expect(w.get('[data-testid="model-list"]').text()).toBe('Mine')
  })

  it('says why a new model could not be created, and stays on the list', async () => {
    const store = new MemoryModelStore()
    vi.spyOn(store, 'create').mockRejectedValueOnce(new Error('offline'))
    const { w, router } = list(store)
    await flushPromises()
    await w.get('[data-testid="new-model"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-testid="create-error"]').text()).toBe('Could not create a model: offline.')
    expect(router.currentRoute.value.name).not.toBe('model')
  })

  it('offers Edit home page only when there is a home model to edit', async () => {
    const store = new MemoryModelStore()
    const links = async () => {
      const { w } = list(store)
      await flushPromises()
      return w.findAll('nav a').map((a) => a.text())
    }
    expect(await links()).toEqual(['Home page'])
    await store.put(HOME_ID, { version: 2, name: 'Home page', features: [] })
    expect(await links()).toEqual(['Home page', 'Edit home page'])
  })
})
