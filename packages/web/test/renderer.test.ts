import { generate, type AppModel } from '@feature-domain/engine'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import DocumentView from '../src/renderer/DocumentView.vue'
import { FETCH_JSON, selectRows, type FetchJson } from '../src/renderer/rows'
import { at, inst, model, page } from './helpers'

function render(m: AppModel, fetchJson: FetchJson = async () => []) {
  return mount(DocumentView, { props: { root: generate(m).root }, global: { provide: { [FETCH_JSON as symbol]: fetchJson } } })
}

describe('DocumentView', () => {
  it('renders the document tree with one element per node and model ids on feature and slot nodes', () => {
    const w = render(
      model(
        page({ background_color: '#eee' }),
        inst('HeaderFeature', '2', { text: 'Title', size: 3, align: 'right', text_style: 'success' }),
        inst('ContainerFeature', 'c', { columns: 2, well: true }),
        inst('TextFeature', 't', { text: 'In a cell' }, at('c', 'r1c2')),
        inst('PanelFeature', 'p', { heading: 'Panel', style: 'info' }, at('c', 'r1c1')),
      ),
    )
    const root = w.get('.fd-root')
    expect(root.attributes()).toMatchObject({ 'data-node-id': '$root', 'data-slot': 'content', 'data-slot-parent': '$root' })
    expect(w.get('[data-feature-id="1"]').attributes('style')).toContain('background-color: rgb(238, 238, 238)')
    expect(w.get('[data-feature-id="1"]').attributes()).toMatchObject({ 'data-slot': 'content', 'data-slot-parent': '1' })

    const heading = w.get('[data-feature-id="2"]')
    expect(heading.element.tagName).toBe('H3')
    expect(heading.classes()).toEqual(['fd-heading', 'fd-align-right', 'fd-tone-success'])
    expect(heading.text()).toBe('Title')

    const grid = w.get('[data-feature-id="c"]')
    expect(grid.classes()).toContain('fd-well')
    expect(grid.attributes('style')).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    const cell = w.get('[data-node-id="c.r1c2"]')
    expect(cell.attributes()).toMatchObject({ 'data-slot': 'r1c2', 'data-slot-parent': 'c' })
    expect(cell.get('[data-feature-id="t"]').text()).toBe('In a cell')

    const panel = w.get('[data-feature-id="p"]')
    expect(panel.classes()).toContain('fd-panel-info')
    expect(panel.get('.fd-panel-heading').text()).toBe('Panel')
    expect(panel.get('[data-node-id="p.body"]').attributes('data-slot-parent')).toBe('p')
  })

  it('renders text literally, never as HTML or template bindings', () => {
    const text = '<b>bold</b> {{ DataResource.x }} <script>alert(1)</script>'
    const w = render(model(page(), inst('TextFeature', 't', { text })))
    const el = w.get('[data-feature-id="t"]')
    expect(el.text()).toBe(text)
    expect(el.find('b').exists()).toBe(false)
    expect(el.find('script').exists()).toBe(false)
  })

  it('drops unsafe image sources', () => {
    const w = render(model(page(), inst('ImageFeature', 'i', { src: 'javascript:alert(1)', alt: 'A' })))
    expect(w.get('img').attributes('src')).toBeUndefined()
  })

  it('gives responsive images no fixed height, so they keep their aspect ratio', () => {
    const w = render(model(page(), inst('ImageFeature', 'i', { src: 'a.png', width: '300', height: '300', responsive: true }), inst('ImageFeature', 'j', { src: 'a.png', width: '300', height: '300', responsive: false })))
    expect(w.get('[data-feature-id="i"]').attributes('style')).toBe('width: 300px;')
    expect(w.get('[data-feature-id="j"]').attributes('style')).toBe('width: 300px; height: 300px;')
  })

  it('sizes images with inline style, treating bare numbers as pixels', () => {
    const w = render(model(page(), inst('ImageFeature', 'i', { src: 'a.png', alt: 'A', width: '300', height: '', align: 'right', responsive: true })))
    const img = w.get('img')
    expect(img.attributes()).toMatchObject({ src: 'a.png', alt: 'A' })
    expect(img.attributes('width')).toBeUndefined()
    expect(img.attributes('style')).toBe('width: 300px;')
    expect(img.classes()).toEqual(['fd-image', 'fd-image-right', 'fd-image-responsive'])
  })
})

describe('tables', () => {
  const tableModel = (inputs: Record<string, string | string[]> = {}) =>
    model(
      page(),
      inst('DataResourceFeature', 'r', { name: 'Repos', resource: 'https://api.github.com/users/x/repos', operation: 'GET' }, null),
      inst('TableFeature', 't', {
        data_resource: 'r',
        fields: ['name', 'description'],
        labels: ['Name', 'About'],
        filters: ['dataLink :data.html_url', 'uppercase'],
        ...inputs,
      }),
    )

  it('loads rows from the resource and renders filtered cells', async () => {
    const fetchJson = vi.fn<FetchJson>(async () => [
      { name: 'one', description: 'first', html_url: 'https://github.com/x/one' },
      { name: 'two', description: null, html_url: 'javascript:alert(1)' },
    ])
    const w = render(tableModel(), fetchJson)
    expect(w.text()).toContain('Loading…')
    await flushPromises()
    expect(fetchJson).toHaveBeenCalledWith('https://api.github.com/users/x/repos')
    expect(w.findAll('th').map((th) => th.text())).toEqual(['Name', 'About'])
    const rows = w.findAll('tbody tr').map((tr) => tr.findAll('td').map((td) => td.text()))
    expect(rows).toEqual([
      ['one', 'FIRST'],
      ['two', ''],
    ])
    const links = w.findAll('tbody a')
    expect(links.map((a) => a.attributes('href'))).toEqual(['https://github.com/x/one'])
    expect(links[0]!.attributes()).toMatchObject({ target: '_blank', rel: 'noopener noreferrer' })
    expect(w.find('.fd-table-note').exists()).toBe(false)
  })

  it('shows load failures and empty results', async () => {
    const failing = render(tableModel(), async () => {
      throw new Error('503 Service Unavailable')
    })
    await flushPromises()
    expect(failing.get('.fd-table-error').text()).toBe('Could not load data: 503 Service Unavailable')

    const empty = render(tableModel(), async () => [])
    await flushPromises()
    expect(empty.get('.fd-table-note').text()).toBe('No rows')
  })

  it('says when there is no data source', () => {
    const w = render(tableModel({ operation: 'POST /nope' }))
    expect(w.get('.fd-table-note').text()).toBe('No data source')
  })
})

describe('selectRows', () => {
  it('reads rows at a path, and requires a list', () => {
    expect(selectRows({ sales: [1, 2] }, 'sales')).toEqual([1, 2])
    expect(selectRows([1], undefined)).toEqual([1])
    expect(() => selectRows({ sales: 3 }, 'sales')).toThrow('"sales" in the response is not a list')
    expect(() => selectRows({}, undefined)).toThrow('The response is not a list')
  })
})
