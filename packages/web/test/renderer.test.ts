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
        page({ background_image: 'bg.png' }),
        inst('HeaderFeature', '2', { text: 'Title', size: 3, align: 'right', text_style: 'success' }),
        inst('ContainerFeature', 'c', { columns: 2, well: true }),
        inst('TextFeature', 't', { text: 'In a cell' }, at('c', 'r1c2')),
        inst('PanelFeature', 'p', { heading: 'Panel', style: 'info' }, at('c', 'r1c1')),
      ),
    )
    const root = w.get('.fd-root')
    expect(root.attributes()).toMatchObject({ 'data-node-id': '$root', 'data-slot': 'content', 'data-slot-parent': '$root' })
    expect(w.get('[data-feature-id="1"]').attributes('style')).toContain('background-image: url("bg.png")')
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
    expect(panel.classes()).toEqual(['fd-panel'])
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
    // Never reaches an <img>: an empty frame stands in for it.
    expect(w.find('img').exists()).toBe(false)
    expect(w.get('[data-feature-id="i"]').classes()).toContain('fd-image-empty')
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

  it('shows skeleton rows under the real header while loading, then the rows and their count', async () => {
    const fetchJson = vi.fn<FetchJson>(async () => [
      { name: 'one', description: 'first', html_url: 'https://github.com/x/one' },
      { name: 'two', description: null, html_url: 'javascript:alert(1)' },
    ])
    const w = render(tableModel(), fetchJson)
    expect(w.get('.fd-table-block').attributes('aria-busy')).toBe('true')
    expect(w.findAll('th').map((th) => th.text())).toEqual(['Name', 'About'])
    expect(w.get('tbody').attributes('aria-hidden')).toBe('true')
    expect(w.findAll('tbody tr')).toHaveLength(3)
    expect(w.findAll('.fd-skeleton')).toHaveLength(6)
    await flushPromises()
    expect(fetchJson).toHaveBeenCalledWith('https://api.github.com/users/x/repos')
    expect(w.get('.fd-table-block').attributes('aria-busy')).toBeUndefined()
    const rows = w.findAll('tbody tr').map((tr) => tr.findAll('td').map((td) => td.text()))
    expect(rows).toEqual([
      ['one', 'FIRST'],
      ['two', ''],
    ])
    expect(w.findAll('tbody td').map((td) => td.attributes('data-label'))).toEqual(['Name', 'About', 'Name', 'About'])
    const links = w.findAll('tbody a')
    expect(links.map((a) => a.attributes('href'))).toEqual(['https://github.com/x/one'])
    expect(links[0]!.attributes()).toMatchObject({ target: '_blank', rel: 'noopener noreferrer' })
    expect(w.get('.fd-table-foot').text()).toBe('2 rows')
    expect(w.find('.fd-table-head').exists()).toBe(false)
  })

  it('puts a title and the row count in the header, and labels the table by it', async () => {
    const w = render(tableModel({ title: 'My repos' }), async () => [{ name: 'one' }])
    expect(w.get('.fd-table-count').text()).toBe('Loading rows…')
    await flushPromises()
    expect(w.get('.fd-table-count').text()).toBe('1 row')
    const title = w.get('.fd-table-title')
    expect(title.text()).toBe('My repos')
    expect(w.get('table').attributes('aria-labelledby')).toBe(title.attributes('id'))
    expect(w.find('.fd-table-foot').exists()).toBe(false)
  })

  it('scrolls after the chosen number of rows, as a keyboard-reachable region', async () => {
    const w = render(tableModel({ title: 'My repos', scroll_rows: '5' } as never), async () => [])
    const wrap = w.get('.fd-table-wrap')
    expect(wrap.classes()).toContain('fd-table-scroll')
    expect(wrap.attributes('style')).toContain('--table-rows: 5')
    expect(wrap.attributes()).toMatchObject({ tabindex: '0', role: 'region', 'aria-labelledby': w.get('.fd-table-title').attributes('id') })
  })

  it('right-aligns figures (number and date filters, or all-number columns) and shows badges', async () => {
    const w = render(
      tableModel({ fields: ['name', 'stars', 'forks', 'updated', 'language'], labels: [], filters: ['', '', 'number', 'date', 'badge'] }),
      async () => [
        { name: 'a', stars: 12, forks: '1204', updated: '2015-03-07T10:00:00Z', language: 'Ruby' },
        { name: 'b', stars: 3, forks: 'n/a', updated: 'never', language: '' },
        { name: 'c', stars: 0, forks: '0', updated: 'never', language: 'Java' },
        { name: 'd', stars: 1, forks: '0', updated: 'never', language: 'ruby' },
      ],
    )
    await flushPromises()
    expect(w.findAll('th').map((th) => th.classes('fd-num'))).toEqual([false, true, true, true, false])
    expect(w.findAll('tbody tr')[0]!.findAll('td').map((td) => td.text())).toEqual(['a', '12', '1,204', 'Mar 7, 2015', 'Ruby'])
    const badges = w.findAll('.fd-badge')
    expect(badges.map((b) => [b.text(), b.classes().find((c) => c.startsWith('fd-badge-'))])).toEqual([
      ['Ruby', 'fd-badge-0'],
      ['Java', 'fd-badge-1'],
      ['ruby', 'fd-badge-0'],
    ])
  })

  it('says which site failed and why, and tries again on request', async () => {
    let fail = true
    const fetchJson = vi.fn<FetchJson>(async () => {
      if (fail) throw new Error('503 Service Unavailable')
      return [{ name: 'one' }]
    })
    const w = render(tableModel(), fetchJson)
    await flushPromises()
    const problem = w.get('.fd-table-problem')
    expect(problem.attributes('role')).toBe('alert')
    expect(problem.text()).toContain("Couldn't load rows")
    expect(problem.text()).toContain('api.github.com: 503 Service Unavailable')
    fail = false
    await problem.get('button').trigger('click')
    await flushPromises()
    expect(fetchJson).toHaveBeenCalledTimes(2)
    expect(w.find('.fd-table-problem').exists()).toBe(false)
    expect(w.findAll('tbody tr')).toHaveLength(1)
  })

  it('shows an empty state with the empty illustration', async () => {
    const empty = render(tableModel(), async () => [])
    await flushPromises()
    const state = empty.get('.fd-table-state')
    expect(state.text()).toContain('No rows yet')
    expect(state.find('svg').exists()).toBe(true)
    expect(empty.find('.fd-table-foot').exists()).toBe(false)
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

describe('separators, links and buttons', () => {
  it('renders a themed separator with its sizes and alignment, and only a plain colour', () => {
    const w = render(model(page(), inst('SeparatorFeature', 's', { thickness: 3, width: 60, align: 'left', color: '#123456' }), inst('SeparatorFeature', 'x', { color: 'url(https://evil.example/x.png)' })))
    const hr = w.get('[data-feature-id="s"]')
    expect(hr.element.tagName).toBe('HR')
    expect(hr.classes()).toEqual(['fd-separator', 'fd-separator-left'])
    expect(hr.attributes('style')).toContain('height: 3px; width: 60%; background-color: rgb(18, 52, 86)')
    expect(w.get('[data-feature-id="x"]').attributes('style') ?? '').not.toContain('url(')
  })

  it('renders links only for http(s) addresses', () => {
    const w = render(model(page(), inst('LinkFeature', 'ok', { text: 'GitHub', href: 'https://github.com' }), inst('LinkFeature', 'bad', { text: 'Run', href: 'javascript:alert(1)' })))
    expect(w.get('[data-feature-id="ok"]').attributes()).toMatchObject({ href: 'https://github.com', target: '_blank', rel: 'noopener noreferrer' })
    expect(w.get('[data-feature-id="ok"]').text()).toBe('GitHub')
    const bad = w.get('[data-feature-id="bad"]')
    expect(bad.element.tagName).toBe('SPAN')
    expect(bad.attributes('href')).toBeUndefined()
  })

  it('renders buttons with their style, size and alignment, disabled without a safe address', () => {
    const w = render(model(page(), inst('ButtonFeature', 'b', { text: 'Buy', href: 'https://shop.example', style: 'soft', size: 'large', align: 'right' }), inst('ButtonFeature', 'n', { href: 'ftp://x' })))
    const row = w.get('[data-feature-id="b"]')
    expect(row.classes()).toEqual(['fd-button-row', 'fd-align-right'])
    const button = row.get('a')
    expect(button.classes()).toEqual(['fd-button', 'fd-button-soft', 'fd-button-large'])
    expect(button.attributes()).toMatchObject({ href: 'https://shop.example', rel: 'noopener noreferrer' })
    expect(button.attributes('role')).toBeUndefined()
    expect(w.get('[data-feature-id="n"] span.fd-button').attributes('aria-disabled')).toBe('true')
  })
})

describe('features composed from primitive nodes', () => {
  it('Text with title renders a heading and paragraphs (split on blank lines) as plain text', () => {
    const w = render(model(page(), inst('TextWithParagraphFeature', 'a', { title: 'About', text: 'First <b>one</b>.\n\n\nSecond.\nStill second.' })))
    const stack = w.get('[data-feature-id="a"]')
    expect(stack.classes()).toEqual(['fd-stack'])
    expect(stack.get('h4.fd-heading').text()).toBe('About')
    expect(stack.findAll('p.fd-paragraph').map((p) => p.text())).toEqual(['First <b>one</b>.', 'Second.\nStill second.'])
    expect(stack.find('b').exists()).toBe(false)
  })

  it('Image with text puts the image on the chosen side, with a quiet frame when there is no usable image', () => {
    const w = render(
      model(
        page(),
        inst('ImageWithParagraphFeature', 'r', { src: 'https://x.test/p.jpg', alt: 'A capybara', image_side: 'right' }),
        inst('ImageWithParagraphFeature', 'n', { src: 'javascript:alert(1)' }),
      ),
    )
    const right = w.get('[data-feature-id="r"]')
    expect(right.classes()).toEqual(['fd-media', 'fd-media-right'])
    expect(right.get('img').attributes()).toMatchObject({ src: 'https://x.test/p.jpg', alt: 'A capybara' })
    expect(right.get('[data-node-id="r.body"]').classes()).toEqual(['fd-stack'])
    const none = w.get('[data-feature-id="n"]')
    expect(none.find('img').exists()).toBe(false)
    expect(none.get('.fd-image-empty').attributes('aria-hidden')).toBe('true')
  })

  it('List card renders a card with a check list and a highlight, omitting empty parts', () => {
    const w = render(model(page(), inst('ListGroupFeature', 'c', { heading: 'Gold', description: '', items: ['A', 'B'], highlight: '$9' })))
    const card = w.get('[data-feature-id="c"]')
    expect(card.element.tagName).toBe('SECTION')
    expect(card.classes()).toEqual(['fd-card'])
    expect(card.get('h4').text()).toBe('Gold')
    expect(card.find('.fd-paragraph-muted').exists()).toBe(false)
    expect(card.get('.fd-list').classes()).toContain('fd-list-check')
    expect(card.findAll('li').map((li) => li.text())).toEqual(['A', 'B'])
    expect(card.get('.fd-paragraph-highlight').text()).toBe('$9')
  })

  it('an Image without a usable source renders a frame of its size instead of a broken image', () => {
    const w = render(model(page(), inst('ImageFeature', 'i', { src: '', width: '300', height: '200' })))
    const frame = w.get('[data-feature-id="i"]')
    expect(frame.element.tagName).toBe('DIV')
    expect(frame.classes()).toContain('fd-image-empty')
    expect(frame.attributes('style')).toContain('width: 300px; height: 200px')
  })
})
