import { coreFeatures, generate, MemoryModelStore, type FeatureDefinition } from '@feature-domain/engine'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import FeatureTree from '../src/editor/FeatureTree.vue'
import { ancestorsOf, buildFeatureTree, descendantCount, parentIds } from '../src/editor/featureTree'
import { paletteGroups } from '../src/editor/palette'
import { summarize } from '../src/editor/status'
import StatusBar from '../src/editor/StatusBar.vue'
import { setModelStore } from '../src/services'
import { useDocumentStore } from '../src/stores/document'
import { at, inst, model, page } from './helpers'

describe('paletteGroups', () => {
  it('groups every core feature exactly once, with short labels', () => {
    const groups = paletteGroups()
    expect(groups.map((g) => g.label)).toEqual(['Layout', 'Content', 'Data and style'])
    const types = groups.flatMap((g) => g.items.map((i) => i.def.type))
    expect(types.sort()).toEqual(coreFeatures.map((d) => d.type).sort())
    expect(groups[2]!.items.map((i) => i.label)).toEqual(['Data', 'Theme'])
  })

  it('puts feature types it does not know under More, so new features are never hidden', () => {
    const extra = { ...coreFeatures[0]!, type: 'ChartFeature', name: 'Chart' } as FeatureDefinition
    expect(paletteGroups([...coreFeatures, extra]).at(-1)).toMatchObject({ label: 'More', items: [{ label: 'Chart' }] })
  })
})

const shellModel = () =>
  model(
    inst('ThemeFeature', 'th', { name: 'Warm', accent: '#e5531a' }, null),
    page({ theme: 'th' }),
    inst('ContainerFeature', 'c', { name: 'Grid', columns: 2 }),
    inst('TextFeature', 't', {}, at('c', 'r1c2')),
    inst('PanelFeature', 'p', {}, at('c', 'r1c1')),
    inst('TextFeature', 'pt', {}, at('p', 'body')),
    inst('MapFeature', 'map'),
    inst('DataResourceFeature', 'r', { name: 'Repos' }, null),
  )

describe('tree helpers', () => {
  const tree = buildFeatureTree(generate(shellModel()))

  it('labels types and shows the theme a page uses', () => {
    expect(tree.roots[0]).toMatchObject({ id: '1', type: 'Page', detail: 'Warm' })
    expect(tree.resources.map((r) => [r.id, r.type])).toEqual([
      ['th', 'Theme'],
      ['r', 'Data'],
    ])
  })

  it('counts descendants, finds ancestors and the rows that can collapse', () => {
    expect(descendantCount(tree.roots[0]!)).toBe(5)
    expect(ancestorsOf(tree.roots, 'pt')).toEqual(['1', 'c', 'p'])
    expect(ancestorsOf(tree.roots, 'nope')).toBeUndefined()
    expect(parentIds(tree.roots)).toEqual(['1', 'c', 'p'])
  })
})

describe('summarize', () => {
  it('counts problems (not info), unported features, resources and themes', () => {
    const s = summarize(generate(shellModel()))
    expect(s.problemsLabel).toBe('1 problem · 1 feature not ported yet')
    expect(s.countsLabel).toBe('6 features · 1 data resource · 1 theme')
    expect(summarize(generate(model(page()))).problemsLabel).toBe('No problems')
  })

  it('StatusBar shows the counts and asks to toggle the problems panel', async () => {
    const w = mount(StatusBar, { props: { result: generate(shellModel()), problemsOpen: false } })
    expect(w.get('[data-testid="status-counts"]').text()).toBe('6 features · 1 data resource · 1 theme')
    await w.get('[data-testid="problems-toggle"]').trigger('click')
    expect(w.emitted('toggleProblems')).toHaveLength(1)
    expect(w.get('[data-testid="problems-toggle"]').attributes('aria-expanded')).toBe('false')
  })
})

describe('FeatureTree collapsing', () => {
  beforeEach(() => setActivePinia(createPinia()))

  async function mountTree() {
    const store = new MemoryModelStore()
    setModelStore(store)
    const doc = useDocumentStore()
    doc.editing = true
    await doc.load(await store.create(shellModel()))
    return { doc, w: mount(FeatureTree) }
  }

  it('collapses a row to a count, and Collapse all / Expand all toggles every row', async () => {
    const { w } = await mountTree()
    expect(w.find('[data-tree-id="pt"]').exists()).toBe(true)
    await w.get('[data-testid="tree-toggle-c"]').trigger('click')
    expect(w.find('[data-tree-id="pt"]').exists()).toBe(false)
    expect(w.get('[data-tree-id="c"]').text()).toContain('3')
    expect(w.get('[data-testid="tree-toggle-c"]').attributes('aria-label')).toBe('Expand Grid')

    // With anything collapsed the button expands everything; then it collapses every row that has children.
    const toggleAll = w.get('[data-testid="tree-toggle-all"]')
    expect(toggleAll.text()).toBe('Expand all')
    await toggleAll.trigger('click')
    expect(w.find('[data-tree-id="pt"]').exists()).toBe(true)
    expect(toggleAll.text()).toBe('Collapse all')
    await toggleAll.trigger('click')
    expect(w.findAll('[data-tree-id]').map((r) => r.attributes('data-tree-id'))).toEqual(['1', 'th', 'r'])
  })

  it('opens collapsed rows when something inside them is selected', async () => {
    const { doc, w } = await mountTree()
    await w.get('[data-testid="tree-toggle-all"]').trigger('click')
    doc.select('pt')
    await nextTick()
    expect(w.find('[data-tree-id="pt"]').exists()).toBe(true)
  })

  it('shows a swatch with the theme accent on Theme rows', async () => {
    const { w } = await mountTree()
    expect(w.get('[data-tree-id="th"] span[aria-hidden="true"]').attributes('style')).toContain('background: rgb(229, 83, 26)')
  })
})
