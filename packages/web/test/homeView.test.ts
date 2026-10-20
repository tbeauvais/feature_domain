import { MemoryModelStore, type AppModel } from '@feature-domain/engine'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { pendingConfirm } from '../src/editor/confirm'
import { setHomeReset, setModelStore } from '../src/services'
import { HOME_ID } from '../src/stores/apiModelStore'
import HomeView from '../src/views/HomeView.vue'
import { inst, model, page } from './helpers'

const home = (): AppModel => model(page(), inst('HeaderFeature', 'h', { text: 'Welcome home' }))

/** The home page over a store holding `stored` as the home model (none when undefined); Reset stores `home()`. */
async function show(stored?: unknown) {
  const store = new MemoryModelStore()
  if (stored !== undefined) await store.put(HOME_ID, stored as AppModel)
  await store.create({ ...model(page()), name: 'Harbor Coffee' })
  setModelStore(store)
  const reset = vi.fn(async () => {
    await store.put(HOME_ID, home())
  })
  setHomeReset(reset)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: HomeView },
      { path: '/models', component: HomeView },
      { path: '/models/:id', name: 'model', component: HomeView },
    ],
  })
  const w = mount(HomeView, { global: { plugins: [router] } })
  await flushPromises()
  return { w, store, reset }
}

const links = (w: Awaited<ReturnType<typeof show>>['w']) => w.findAll('nav a').map((a) => [a.text(), a.attributes('href')])

describe('the home page', () => {
  afterEach(() => {
    pendingConfirm.value?.resolve(false)
    vi.restoreAllMocks()
  })

  it('shows the home model as a page, with the way to every model and to editing it outside it', async () => {
    const { w } = await show(home())
    expect(w.get('[data-testid="home-page"] .fd-root').text()).toContain('Welcome home')
    expect(w.find('[data-testid="home-fallback"]').exists()).toBe(false)
    expect(links(w)).toEqual([
      ['All models', '/models'],
      ['Edit home page', `/models/${HOME_ID}`],
    ])
  })

  it('shows the model list when there is no home page, and puts the built-in one back without asking', async () => {
    const { w, reset } = await show()
    expect(w.get('[data-testid="home-fallback"]').text()).toContain('There is no home page, so here is the model list.')
    expect(w.get('[data-testid="model-list"]').text()).toBe('Harbor Coffee')
    expect(links(w).map(([text]) => text)).toEqual(['All models'])
    await w.get('[data-testid="reset-home"]').trigger('click')
    await flushPromises()
    expect(pendingConfirm.value).toBeNull()
    expect(reset).toHaveBeenCalledOnce()
    expect(w.get('[data-testid="home-page"]').text()).toContain('Welcome home')
  })

  it.each([
    ['an invalid model', { version: 2, name: 'Home', features: 'none' }, 'it is not a valid model: Model has no features list'],
    ['a model with no page', model(), 'it has no page'],
    [
      'a model generating with errors',
      model(page(), inst('TableFeature', 't', { data_resource: 'gone' })),
      'Input "data_resource" references feature gone, which does not exist',
    ],
  ])('shows the model list instead of %s, and asks before resetting it', async (_, stored, reason) => {
    const { w, reset } = await show(stored)
    expect(w.get('[data-testid="home-fallback"]').text()).toContain(`The home page can't be shown (${reason}), so here is the model list.`)
    // It can still be opened in the editor, to fix it there.
    expect(links(w).map(([text]) => text)).toEqual(['All models', 'Edit home page'])
    await w.get('[data-testid="reset-home"]').trigger('click')
    expect(pendingConfirm.value).toMatchObject({ title: 'Reset the home page?', confirmLabel: 'Reset home page', destructive: true })
    pendingConfirm.value!.resolve(false)
    await flushPromises()
    expect(reset).not.toHaveBeenCalled()
    await w.get('[data-testid="reset-home"]').trigger('click')
    pendingConfirm.value!.resolve(true)
    await flushPromises()
    expect(reset).toHaveBeenCalledOnce()
    expect(w.get('[data-testid="home-page"]').text()).toContain('Welcome home')
  })

  it('says why it could not load, and tries again, without offering to reset', async () => {
    const store = new MemoryModelStore()
    await store.put(HOME_ID, home())
    vi.spyOn(store, 'get').mockRejectedValueOnce(new Error('offline'))
    setModelStore(store)
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:any(.*)*', name: 'model', component: HomeView }] })
    const w = mount(HomeView, { global: { plugins: [router] } })
    await flushPromises()
    expect(w.get('[data-testid="home-fallback"]').text()).toContain('Could not load the home page: offline.')
    expect(w.find('[data-testid="reset-home"]').exists()).toBe(false)
    await w.get('[data-testid="home-fallback"] button').trigger('click')
    await flushPromises()
    expect(w.get('[data-testid="home-page"]').text()).toContain('Welcome home')
  })

  it('says why it could not reset, and stays on the list', async () => {
    const { w, reset } = await show()
    reset.mockRejectedValueOnce(new Error('the server answered 500'))
    await w.get('[data-testid="reset-home"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-testid="home-fallback"] [role="alert"]').text()).toBe('Could not reset the home page: the server answered 500.')
    expect(w.find('[data-testid="model-list"]').exists()).toBe(true)
  })
})
