import { describe, expect, it } from 'vitest'
import { CHART_HEIGHTS, generate, migrate, type DocNodeOf } from '../src'
import { inst, model, page } from './helpers'

const people = inst('DataResourceFeature', 'r', { name: 'People', source: 'sample', sample_rows: '[{"name": "Ada", "score": 3}]' }, null)
const chartProps = (inputs: Record<string, string>) => {
  const r = generate(model(people, page(), inst('GoogleChartFeature', 'c', { data_resource: 'r', ...inputs })))
  return { props: (r.root.children[0]!.children[0] as DocNodeOf<'chart'>).props, problems: r.diagnostics.map((d) => d.message) }
}

describe('ChartFeature', () => {
  it('charts a resource\'s rows: columns of medium height by default, fields guessed later from the rows', () => {
    const { props, problems } = chartProps({})
    expect(problems).toEqual([])
    expect(props).toEqual({ type: 'column', height: CHART_HEIGHTS.medium, source: { feature: 'r', resource: 'People', operation: 'GET rows', endPoint: '', rows: [{ name: 'Ada', score: 3 }] } })
  })

  it('takes its type, height, title, description and fields, ignoring unknown types and heights', () => {
    expect(chartProps({ chart_type: 'donut', height: 'tall', title: ' Scores ', description: 'Scores by person', label_field: 'name', value_field: 'score' }).props).toMatchObject({
      type: 'donut',
      height: CHART_HEIGHTS.tall,
      title: 'Scores',
      description: 'Scores by person',
      labelField: 'name',
      valueField: 'score',
    })
    expect(chartProps({ chart_type: '3d', height: 'huge' }).props).toMatchObject({ type: 'column', height: CHART_HEIGHTS.medium })
  })

  it('says what is wrong instead of drawing from the wrong operation', () => {
    expect(chartProps({ operation: 'POST rows' })).toMatchObject({ problems: ['"POST rows" adds rows; a chart lists them with the GET operation'] })
    expect(chartProps({ operation: 'GET /gone' }).problems).toEqual(['Operation "GET /gone" is not provided by People'])
    const r = generate(model(page(), inst('GoogleChartFeature', 'c', {})))
    expect(r.diagnostics.map((d) => d.code)).toContain('unresolved-reference')
  })
})

describe('migrating the legacy Google Chart', () => {
  const legacy = (inputs: Record<string, unknown>) =>
    migrate({
      features: [
        { feature: 'PageFeature', id: '1', inputs: { name: 'Page', page_location: { target: '#content_section' } } },
        { feature: 'DataResourceFeature', id: '2', inputs: { name: 'Sales', resource: 'https://x.test/sales', operation: 'GET' } },
        { feature: 'GoogleChartFeature', id: '3', inputs: { name: 'Chart', data_resource: { name: 'Sales', operation: 'GET /sales' }, page_location: { target: '#page_container' }, ...inputs } },
      ],
    })

  it('maps the Google types, fields and alt text, dropping the legacy color, size and alignment', () => {
    const r = legacy({ type: 'bhs', color: '#179de8', field: 'amount', label: 'name', alt: 'Sales by person', height: '200', width: '300', align: 'center-block' })
    expect(r.model.features[2]!.inputs).toEqual({ name: 'Chart', disable: false, data_resource: '2', operation: 'GET /sales', chart_type: 'bar', label_field: 'name', value_field: 'amount', description: 'Sales by person' })
    expect(r.model.features[2]!.placement).toEqual({ parent: '1', slot: 'content' })
    expect(r.notes.map((n) => n.code)).toContain('dropped-style')
    expect(legacy({ type: 'p' }).model.features[2]!.inputs.chart_type).toBe('pie')
    expect(legacy({ type: 'bvs' }).model.features[2]!.inputs.chart_type).toBe('column')
  })

  it('notes a 3D pie drawn flat, an unknown type and dropped filters, and leaves out the default "Cool chart" alt', () => {
    const p3 = legacy({ type: 'p3', alt: 'Cool chart', filters: 'uppercase' })
    expect(p3.model.features[2]!.inputs).toMatchObject({ chart_type: 'pie', description: '' })
    expect(p3.notes.map((n) => n.message)).toEqual(expect.arrayContaining(['The legacy 3D pie chart is drawn as a flat pie', 'Dropped chart filters "uppercase", which charts don\'t use']))
    const odd = legacy({ type: 'lc' })
    expect(odd.model.features[2]!.inputs.chart_type).toBe('column')
    expect(odd.notes.map((n) => n.message)).toContain('Unknown legacy chart type "lc"; drawn as columns')
  })
})
