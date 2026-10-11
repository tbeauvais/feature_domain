import { generate, MemoryModelStore, NIGHT_GARDEN, themeInputs, type AppModel } from '@feature-domain/engine'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { dragState } from '../src/editor/dndState'
import EmptyPageHint from '../src/editor/EmptyPageHint.vue'
import FeatureTree from '../src/editor/FeatureTree.vue'
import Inspector from '../src/editor/Inspector.vue'
import { setModelStore } from '../src/services'
import { useDocumentStore } from '../src/stores/document'
import DiagnosticsList from '../src/views/DiagnosticsList.vue'
import ModelListView from '../src/views/ModelListView.vue'
import { at, inst, model, page } from './helpers'

beforeEach(() => setActivePinia(createPinia()))

async function load(m: AppModel, selected: string | null = null) {
  const store = new MemoryModelStore()
  setModelStore(store)
  const doc = useDocumentStore()
  doc.editing = true
  await doc.load(await store.create(m))
  doc.select(selected)
  return doc
}

const theme = (id: string, inputs: Record<string, string | number> = {}) => inst('ThemeFeature', id, { name: 'Warm Editorial', ...inputs }, null)
const button = (w: ReturnType<typeof mount>, text: string) => w.findAll('button').find((b) => b.text() === text)!

describe('Theme inspector', () => {
  it('groups the settings into sections, with short choices as buttons', async () => {
    await load(model(theme('th'), page({ theme: 'th' })), 'th')
    const w = mount(Inspector)
    expect(w.findAll('section[aria-label] > h3').map((h) => h.text())).toEqual(['Colour', 'Typography', 'Shape and space', 'Components'])
    const corners = w.get('[data-testid="inspector-section-Shape and space"]').findAll('[role="group"]')[0]!
    expect(corners.findAll('button').map((b) => b.text())).toEqual(['None', 'Small', 'Soft', 'Round'])
    // Long labels (font pairings, scales) stay a select.
    expect(w.get('[data-testid="inspector-section-Typography"]').findAll('select')).toHaveLength(2)
  })

  it('starts from a built-in theme in one undo step, marking the one every setting matches', async () => {
    const doc = await load(model(theme('th'), page({ theme: 'th' })), 'th')
    const w = mount(Inspector)
    const pressed = () => w.findAll('[data-preset]').filter((b) => b.attributes('aria-pressed') === 'true').map((b) => b.attributes('data-preset'))
    expect(pressed()).toEqual(['warm-editorial'])

    await w.get('[data-preset="night-garden"]').trigger('click')
    const inputs = doc.model!.features.find((f) => f.id === 'th')!.inputs
    expect(inputs).toMatchObject({ ...themeInputs(NIGHT_GARDEN), name: 'Night Garden' })
    expect(doc.result!.root.children[0]!.props).toMatchObject({ theme: { scheme: 'dark' } })
    expect(pressed()).toEqual(['night-garden'])

    // Any change of its own means it no longer matches a built-in theme.
    doc.setInputs('th', { accent: '#123456' })
    await flushPromises()
    expect(pressed()).toEqual([])

    doc.undo()
    doc.undo()
    expect(doc.model!.features.find((f) => f.id === 'th')!.inputs).toEqual({ name: 'Warm Editorial' })
  })

  it('keeps a name of its own when starting from a built-in theme', async () => {
    const doc = await load(model(theme('th', { name: 'Brand' })), 'th')
    mount(Inspector)
    doc.applyThemePreset('th', 'night-garden')
    expect(doc.model!.features[0]!.inputs).toMatchObject({ name: 'Brand', scheme: 'dark' })
  })
})

describe('Used by', () => {
  it('lists the pages on a theme, and selecting one selects that page', async () => {
    const doc = await load(model(theme('th'), page({ theme: 'th', name: 'Home' }), inst('PageFeature', '2', { theme: 'th', name: 'Pricing' }, at('$root', 'content'))), 'th')
    const w = mount(Inspector)
    expect(w.get('[data-testid="used-by-summary"]').text()).toBe('used by 2 pages')
    expect(w.findAll('[data-used-by]').map((b) => b.text())).toEqual(['HomePage #1', 'PricingPage #2'])
    await w.get('[data-used-by="2"]').trigger('click')
    expect(doc.selectedId).toBe('2')
  })

  it('lists the tables reading a data resource, and nothing for features nothing uses', async () => {
    await load(model(inst('DataResourceFeature', 'r', { resource: 'https://api.github.com/users/x/repos', operation: 'GET' }, null), page(), inst('TableFeature', 't', { data_resource: 'r', name: 'Repos' })), 'r')
    const w = mount(Inspector)
    expect(w.get('[data-testid="used-by-summary"]').text()).toBe('used by 1 table')
    expect(w.findAll('[data-used-by]').map((b) => b.attributes('data-used-by'))).toEqual(['t'])

    const doc = useDocumentStore()
    doc.select('t')
    await flushPromises()
    expect(w.find('[data-testid="used-by"]').exists()).toBe(false)
    expect(w.find('[data-testid="used-by-summary"]').exists()).toBe(false)
  })

  it('offers an unused theme to the pages without one, or explains when every page has another', async () => {
    const doc = await load(model(theme('th'), page(), inst('PageFeature', '2', { theme: 'th2' }, at('$root', 'content')), theme('th2')), 'th')
    const w = mount(Inspector)
    expect(w.get('[data-testid="used-by-summary"]').text()).toBe('not used yet')
    await w.get('[data-testid="use-theme"]').trigger('click')
    // Only the page without a theme takes it; page 2 keeps its own.
    expect(doc.model!.features.filter((f) => f.feature === 'PageFeature').map((f) => f.inputs.theme)).toEqual(['th', 'th2'])

    doc.select('th2')
    await flushPromises()
    doc.select('th')
    doc.setInputs('1', { theme: 'th2' })
    await flushPromises()
    expect(w.find('[data-testid="use-theme"]').exists()).toBe(false)
    expect(w.get('[data-testid="used-by"]').text()).toContain("Every page uses another theme")
  })
})

describe('Empty states', () => {
  it('summarises the model when nothing is selected, and adds a theme from there', async () => {
    const doc = await load(model(page()))
    const w = mount(Inspector)
    expect(w.get('[data-testid="inspector-idle"]').text()).toContain('1 page · nothing on it yet')
    await w.get('[data-testid="add-theme"]').trigger('click')
    const added = doc.model!.features.find((f) => f.feature === 'ThemeFeature')!
    expect(doc.selectedId).toBe(added.id)
    expect(doc.model!.features.find((f) => f.feature === 'PageFeature')!.inputs.theme).toBe(added.id)

    doc.select(null)
    await flushPromises()
    expect(w.find('[data-testid="add-theme"]').exists()).toBe(false)
  })

  it('shows a hint with quick-add buttons over an empty page, but not during a drag or once it has content', async () => {
    const doc = await load(model(page()))
    const container = document.createElement('div')
    container.innerHTML = '<div data-node-id="1"></div>'
    document.body.append(container)
    const w = mount(EmptyPageHint, { props: { container, root: doc.result!.root }, attachTo: document.body })
    await flushPromises()
    expect(w.findAll('[data-testid="empty-page-hint"]')).toHaveLength(1)

    dragState.value = { source: { kind: 'palette', featureType: 'TextFeature' }, zone: null, evaluation: null, element: null, surface: null } as never
    await flushPromises()
    expect(w.find('[data-testid="empty-page-hint"]').exists()).toBe(false)
    dragState.value = null
    await flushPromises()

    await w.get('[data-testid="quick-add-HeaderFeature"]').trigger('click')
    expect(doc.model!.features.find((f) => f.feature === 'HeaderFeature')?.placement).toEqual({ parent: '1', slot: 'content' })
    await w.setProps({ root: doc.result!.root })
    await flushPromises()
    expect(w.find('[data-testid="empty-page-hint"]').exists()).toBe(false)
    w.unmount()
    container.remove()
  })

  it('says so in the tree when there is nothing on the page, and in the problems list when there are none', async () => {
    const doc = await load(model(page()))
    const tree = mount(FeatureTree)
    expect(tree.get('[data-testid="tree-empty"]').text()).toBe('Nothing on this page yet.')
    doc.add('TextFeature')
    await flushPromises()
    expect(tree.find('[data-testid="tree-empty"]').exists()).toBe(false)

    expect(mount(DiagnosticsList, { props: { diagnostics: [] } }).get('[data-testid="no-problems"]').text()).toContain('No problems')
    expect(generate(model(page())).diagnostics).toEqual([])
  })

  it('explains models and offers to start one when there are none', async () => {
    setModelStore(new MemoryModelStore())
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: ModelListView }, { path: '/models/:id', name: 'model', component: ModelListView }] })
    const w = mount(ModelListView, { global: { plugins: [router] } })
    await flushPromises()
    const empty = w.get('[data-testid="no-models"]')
    expect(empty.text()).toContain('No models yet')
    await empty.get('button').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('model')
  })
})
