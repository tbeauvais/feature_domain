import { generate, type AppModel } from '@feature-domain/engine'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { asNumber, chartData, MAX_CHART_POINTS } from '../src/renderer/chartData'
import DocumentView from '../src/renderer/DocumentView.vue'
import { FETCH_JSON, type FetchJson } from '../src/renderer/rows'
import { inst, model, page } from './helpers'

describe('chartData', () => {
  it('guesses the label (first text field) and value (first number field) when not given', () => {
    const rows = [
      { id: 1, region: 'North', sales: '18250' },
      { id: 2, region: 'South', sales: 12900 },
    ]
    // "id" is a number too, but ids are rarely what anyone wants charted: it is passed over.
    expect(chartData(rows)).toEqual({ labels: ['North', 'South'], values: [18250, 12900], labelField: 'region', valueField: 'sales', skipped: 0 })
    expect(chartData(rows, 'region', 'sales')).toMatchObject({ labels: ['North', 'South'], values: [18250, 12900] })
  })

  it('passes over id-like fields and long text when guessing, but uses them when nothing else fits', () => {
    const repos = [
      {
        id: 7,
        node_id: 'MDEwOlJlcG9z',
        ownerId: 3,
        description: 'A very long description of the repository, far past forty characters',
        name: 'engine',
        stars: 12,
      },
    ]
    expect(chartData(repos)).toMatchObject({ labelField: 'name', valueField: 'stars' })
    expect(chartData([{ id: 1, node_id: 'abc' }])).toMatchObject({ labelField: 'node_id', valueField: 'id' })
  })

  it('skips rows without a number, numbers rows without a label, and caps the points', () => {
    expect(chartData([{ v: 1 }, { v: 'n/a' }, { v: 3 }], undefined, 'v')).toEqual({ labels: ['1', '3'], values: [1, 3], valueField: 'v', skipped: 1 })
    const many = Array.from({ length: MAX_CHART_POINTS + 7 }, (_, i) => ({ name: `r${i}`, n: i }))
    expect(chartData(many)).toMatchObject({ skipped: 7 })
    expect(chartData(many).values).toHaveLength(MAX_CHART_POINTS)
    expect(chartData([])).toEqual({ labels: [], values: [], skipped: 0 })
  })

  it('reads only plain decimals as numbers', () => {
    expect(['12', '-3.5', ' 7 '].map(asNumber)).toEqual([12, -3.5, 7])
    expect(['1e3', '0x10', '', 'Infinity', null, Number.NaN].map(asNumber)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined])
  })
})

describe('ChartNode', () => {
  const sales = inst(
    'DataResourceFeature',
    'r',
    {
      name: 'Sales',
      source: 'sample',
      sample_rows: JSON.stringify([
        { region: 'North', sales: 5 },
        { region: 'South', sales: 3 },
      ]),
    },
    null,
  )
  // The chart component is loaded lazily (Chart.js is large): wait for it to arrive before looking.
  const render = async (m: AppModel, fetchJson: FetchJson = async () => []) => {
    const w = mount(DocumentView, { props: { root: generate(m).root }, global: { provide: { [FETCH_JSON as symbol]: fetchJson } } })
    await vi.dynamicImportSettled()
    await flushPromises()
    return w
  }

  it('draws on a labeled canvas and gives screen readers the numbers in a table', async () => {
    const w = await render(
      model(sales, page(), inst('GoogleChartFeature', 'c', { data_resource: 'r', title: 'Sales by region', chart_type: 'pie', height: 'short' })),
    )
    await flushPromises()
    const figure = w.get('figure.fd-chart-block')
    expect(figure.get('figcaption').text()).toBe('Sales by region')
    expect(figure.attributes('aria-labelledby')).toBe(figure.get('figcaption').attributes('id'))
    expect(w.get('canvas').attributes()).toMatchObject({ role: 'img', 'aria-label': 'Sales by region: pie chart of sales by region' })
    expect(w.get('.fd-chart-canvas').attributes('style')).toContain('height: 220px')
    const table = w.get('.fd-visually-hidden table')
    expect(table.findAll('thead th').map((th) => th.text())).toEqual(['region', 'sales'])
    expect(table.findAll('tbody tr').map((tr) => tr.text())).toEqual(['North5', 'South3'])
  })

  it('says how many rows were left out of the drawing, and why', async () => {
    const mixed = inst(
      'DataResourceFeature',
      'r',
      {
        source: 'sample',
        sample_rows: JSON.stringify([
          { region: 'North', sales: 5 },
          { region: 'South', sales: 'n/a' },
          { region: 'East', sales: 2 },
        ]),
      },
      null,
    )
    const w = await render(model(mixed, page(), inst('GoogleChartFeature', 'c', { data_resource: 'r', value_field: 'sales' })))
    expect(w.get('.fd-chart-skipped').text()).toBe('1 row left out (no number in "sales")')
  })

  it('shows values in its Value format, as tables do', async () => {
    const w = await render(model(sales, page(), inst('GoogleChartFeature', 'c', { data_resource: 'r', value_format: 'currency' })))
    expect(w.findAll('.fd-visually-hidden tbody td').map((td) => td.text())).toEqual(['$5.00', '$3.00'])
  })

  it('uses the description for screen readers when there is one', async () => {
    const w = await render(model(sales, page(), inst('GoogleChartFeature', 'c', { data_resource: 'r', description: 'North sells most' })))
    await flushPromises()
    expect(w.get('canvas').attributes('aria-label')).toBe('North sells most')
  })

  it('marks itself busy while rows load', async () => {
    let resolve: (rows: unknown) => void = () => {}
    const remote = inst('DataResourceFeature', 'r', { resource: 'https://api.test/rows' }, null)
    const w = await render(model(remote, page(), inst('GoogleChartFeature', 'c', { data_resource: 'r' })), () => new Promise((r) => (resolve = r)))
    expect(w.get('.fd-chart-block').attributes('aria-busy')).toBe('true')
    expect(w.find('.fd-chart-skeleton').exists()).toBe(true)
    resolve([{ name: 'a', n: 1 }])
    await flushPromises()
    expect(w.get('.fd-chart-block').attributes('aria-busy')).toBeUndefined()
  })

  it('shows errors with Try again, and what is missing instead of an empty drawing', async () => {
    let fail = true
    const fetchJson: FetchJson = async () => {
      if (fail) throw new Error('offline')
      return [{ name: 'a' }]
    }
    const remote = inst('DataResourceFeature', 'r', { resource: 'https://api.test/rows' }, null)
    const w = await render(model(remote, page(), inst('GoogleChartFeature', 'c', { data_resource: 'r' })), fetchJson)
    expect(w.get('[role="alert"]').text()).toContain('api.test: offline')
    fail = false
    await w.get('.fd-retry').trigger('click')
    await flushPromises()
    // Rows without numbers: nothing to draw, said in words.
    expect(w.get('.fd-state').text()).toBe('No numbers to chart.')
    expect(w.find('.fd-visually-hidden').exists()).toBe(false)

    const empty = await render(
      model(inst('DataResourceFeature', 'r', { source: 'sample', sample_rows: '[]' }, null), page(), inst('GoogleChartFeature', 'c', { data_resource: 'r' })),
    )
    await flushPromises()
    expect(empty.get('.fd-state').text()).toBe('No rows to chart yet.')
    // A resource with nothing a chart can list (no GET): no source, said so.
    const postOnly = inst(
      'SwaggerDataResourceFeature',
      's',
      { spec: JSON.stringify({ openapi: '3.0.0', servers: [{ url: 'https://x.test' }], paths: { '/a': { post: {} } } }) },
      null,
    )
    const none = await render(model(postOnly, page(), inst('GoogleChartFeature', 'c', { data_resource: 's' })))
    expect(none.get('.fd-chart-note').text()).toBe('No data source')
  })
})
