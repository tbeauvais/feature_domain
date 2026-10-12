import { NIGHT_GARDEN, themeInputs } from '@feature-domain/engine'
import { inCell, inPage, root, sample } from './build'

// A sales dashboard (it replaces the legacy Swagger sample): an API spec answering with sample sales feeds a table, a
// chart, a count and a form; logging a deal updates all of them at once.
const sale = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Deal id' },
    rep: { type: 'string', description: 'Sales rep' },
    region: { type: 'string', description: 'Region' },
    amount: { type: 'number', description: 'Amount in US dollars' },
    closed: { type: 'string', format: 'date', description: 'Date closed' },
  },
}

const spec = {
  openapi: '3.0.3',
  info: { title: 'Northwind Sales API', version: '1.0.0' },
  servers: [{ url: 'https://api.northwind.example' }],
  components: { schemas: { Sale: sale, NewSale: { ...sale, required: ['rep', 'region', 'amount'], properties: { rep: sale.properties.rep, region: sale.properties.region, amount: sale.properties.amount, closed: sale.properties.closed } } } },
  paths: {
    '/v1/sales': {
      get: { summary: 'List closed deals', responses: { '200': { description: 'Deals', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Sale' } } } } } } },
      post: {
        summary: 'Log a closed deal',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/NewSale' } } } },
        responses: { '201': { description: 'Logged', content: { 'application/json': { schema: { $ref: '#/components/schemas/Sale' } } } } },
      },
    },
    '/v1/sales/{id}': {
      delete: { summary: 'Remove a deal', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '204': { description: 'Removed' } } },
    },
  },
}

const deals = [
  { id: '1', rep: 'Avery Chen', region: 'Northeast', amount: 18250, closed: '2026-09-30' },
  { id: '2', rep: 'Casey Nguyen', region: 'West', amount: 15100, closed: '2026-09-26' },
  { id: '3', rep: 'Jordan Patel', region: 'Midwest', amount: 12900, closed: '2026-09-24' },
  { id: '4', rep: 'Sam Rivera', region: 'West', amount: 9600, closed: '2026-09-18' },
  { id: '5', rep: 'Morgan Lee', region: 'South', amount: 7400, closed: '2026-09-11' },
  { id: '6', rep: 'Riley Brooks', region: 'Northeast', amount: 4300, closed: '2026-09-03' },
]

export const sales = sample('Northwind sales', (add) => {
  const theme = add('ThemeFeature', { ...themeInputs(NIGHT_GARDEN), name: 'Night Garden' })
  const api = add('SwaggerDataResourceFeature', { name: 'Northwind Sales API', spec_url: 'https://api.northwind.example/openapi.json', spec: JSON.stringify(spec), source: 'sample', sample_rows: JSON.stringify(deals, null, 2) })
  const page = add('PageFeature', { name: 'Page', theme }, root())
  add('HeaderFeature', { name: 'Title', text: 'Q3 sales', size: 1, align: 'left' }, inPage(page))
  add('TextFeature', { name: 'Count', text: '{{length}} deals closed this quarter. Log a new one below and the table and chart update at once.', data_resource: api }, inPage(page))
  const top = add('ContainerFeature', { name: 'Overview', rows: 1, columns: 2, well: false }, inPage(page))
  add(
    'GoogleChartFeature',
    { name: 'Revenue', title: 'Revenue by rep', data_resource: api, chart_type: 'bar', label_field: 'rep', value_field: 'amount', value_format: 'currency', height: 'medium', description: 'Revenue from closed deals by sales rep' },
    inCell(top, 1, 1),
  )
  add(
    'FormFeature',
    {
      name: 'Log a deal',
      title: 'Log a closed deal',
      data_resource: api,
      operation: 'POST /v1/sales',
      fields: ['rep', 'region', 'amount', 'closed'],
      labels: ['Sales rep', 'Region', 'Amount (USD)', 'Date closed'],
      required_fields: ['rep', 'region', 'amount'],
      submit_label: 'Log deal',
      success_message: 'Deal logged.',
    },
    inCell(top, 1, 2),
  )
  add(
    'TableFeature',
    {
      name: 'Deals',
      title: 'Closed deals',
      data_resource: api,
      delete_operation: 'DELETE /v1/sales/{id}',
      fields: ['rep', 'region', 'amount', 'closed'],
      labels: ['Sales rep', 'Region', 'Amount', 'Closed'],
      filters: ['', 'badge', 'currency', 'date'],
      scroll_rows: 10,
    },
    inPage(page),
  )
})
