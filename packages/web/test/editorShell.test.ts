import { coreFeatures, generate, MemoryModelStore, type FeatureDefinition } from '@feature-domain/engine'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import FeatureTree from '../src/editor/FeatureTree.vue'
import { ancestorsOf, buildFeatureTree, descendantCount, parentIds } from '../src/editor/featureTree'
import { paletteGroups } from '../src/editor/palette'
import { loadCanvasWidth, saveCanvasWidth } from '../src/editor/canvasWidth'
import Palette from '../src/editor/Palette.vue'
import { summarize, themeSummary } from '../src/editor/status'
import StatusBar from '../src/editor/StatusBar.vue'
import { setModelStore } from '../src/services'
import { useDocumentStore } from '../src/stores/document'
import { at, inst, model, page } from './helpers'

describe('paletteGroups', () => {
  it('groups every core feature exactly once, with short labels', () => {
    const groups = paletteGroups()
    expect(groups.map((g) => g.label)).toEqual(['Layout', 'Text', 'Media and cards', 'Data and style'])
    const types = groups.flatMap((g) => g.items.map((i) => i.def.type))
    expect(types.sort()).toEqual(coreFeatures.map((d) => d.type).sort())
    expect(groups[3]!.items.map((i) => i.label)).toEqual(['Data', 'Table', 'Theme'])
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
    return { doc, store, w: mount(FeatureTree) }
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
    expect(w.get('[data-tree-id="th"] span[aria-hidden="true"]').attributes('style')).toContain('background-color: rgb(229, 83, 26)')
  })

  it('the swatch shows the colour the theme really uses: never raw input, which could load from other sites', async () => {
    const store = new MemoryModelStore()
    setModelStore(store)
    const doc = useDocumentStore()
    doc.editing = true
    await doc.load(await store.create(model(inst('ThemeFeature', 'th', { accent: 'url(https://evil.example/x.png)' }, null), page({ theme: 'th' }))))
    const w = mount(FeatureTree)
    const style = w.get('[data-tree-id="th"] span[aria-hidden="true"]').attributes('style')
    expect(style).toContain('background-color: rgb(229, 83, 26)')
    expect(style).not.toContain('url(')
  })

  it('starts expanded when another model loads (instance ids repeat across models)', async () => {
    const { doc, store, w } = await mountTree()
    await w.get('[data-testid="tree-toggle-c"]').trigger('click')
    expect(w.find('[data-tree-id="pt"]').exists()).toBe(false)
    await doc.load(await store.create(shellModel()))
    await nextTick()
    expect(w.find('[data-tree-id="pt"]').exists()).toBe(true)
  })
})

describe('themeSummary', () => {
  it('names the default, a theme used everywhere, or how themes split across pages', () => {
    expect(themeSummary(generate(model(page())))).toBe('Default theme (Warm Editorial)')
    expect(themeSummary(generate(shellModel()))).toBe('Theme: Warm')
    const split = model(
      inst('ThemeFeature', 'a', { name: 'Warm' }, null),
      inst('ThemeFeature', 'b', { name: 'Night' }, null),
      page({ theme: 'a' }),
      inst('PageFeature', '2', { name: 'Two', theme: 'b' }, at('$root', 'content')),
      inst('PageFeature', '3', { name: 'Three' }, at('$root', 'content')),
    )
    expect(themeSummary(generate(split))).toBe('Themes: Warm on 1 of 3 pages · Night on 1 of 3 pages · default on 1')
    // An unused theme doesn't count.
    expect(themeSummary(generate(model(inst('ThemeFeature', 'a', {}, null), page())))).toBe('Default theme (Warm Editorial)')
  })
})

describe('editor preferences', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('remember the canvas width, and fall back when storage holds junk or is unavailable', () => {
    localStorage.clear()
    expect(loadCanvasWidth()).toBe('desktop')
    saveCanvasWidth('phone')
    expect(loadCanvasWidth()).toBe('phone')
    localStorage.setItem('feature-domain:canvas-width', 'watch')
    expect(loadCanvasWidth()).toBe('desktop')

    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(loadCanvasWidth()).toBe('desktop')
    expect(() => saveCanvasWidth('tablet')).not.toThrow()
  })

  it('the palette folds away and remembers it, keeping its tiles in the page for drag and drop', async () => {
    localStorage.clear()
    setActivePinia(createPinia())
    const w = mount(Palette)
    const toggle = w.get('[data-testid="palette-toggle"]')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(w.get('#palette-groups').isVisible()).toBe(false)
    expect(w.find('[data-testid="palette-TextFeature"]').exists()).toBe(true)
    expect(localStorage.getItem('feature-domain:palette')).toBe('folded')
    expect(mount(Palette).get('[data-testid="palette-toggle"]').attributes('aria-expanded')).toBe('false')
  })
})
