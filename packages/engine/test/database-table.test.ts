import { describe, expect, it } from 'vitest'
import { generate, isDatabaseTableExports, proxyAddresses, type DocNodeOf, type FeatureInstance, type InputValue } from '../src'
import { inst, model, page } from './helpers'

const FIELDS = [
  'title: text, required',
  'details: long text',
  'priority: choice low | normal | high, default normal',
  'due: date',
  'urgent: yes/no',
  'hours: number',
]

const table = (inputs: Record<string, InputValue> = {}, id = 't'): FeatureInstance =>
  inst('DatabaseTableFeature', id, { name: 'Requests', fields: FIELDS, ...inputs }, null)

/** Generates a page holding `features` (placed on page 1) after the table, and returns the page's nodes and problems. */
function run(tableInputs: Record<string, InputValue>, ...features: FeatureInstance[]) {
  const r = generate(model(table(tableInputs), page(), ...features))
  return { result: r, nodes: r.root.children[0]!.children, problems: r.diagnostics.map((d) => `${d.featureInstanceId}: ${d.message}`) }
}

describe('DatabaseTableFeature', () => {
  it('exports a data resource over its rows, addressed relative to the app, and the table for the Worker', () => {
    const { result, problems } = run({ sample_rows: '[{"title": "Paint the hall", "hours": "3"}]' })
    expect(problems).toEqual([])
    const exports = result.exports.get('t')
    expect(isDatabaseTableExports(exports)).toBe(true)
    expect(exports).toEqual({
      resource: 'Requests',
      operations: [
        { name: 'GET rows', method: 'GET', endPoint: 'tables/t/rows', responseType: 'Rows', summary: 'List the rows' },
        {
          name: 'POST rows',
          method: 'POST',
          endPoint: 'tables/t/rows',
          responseType: 'Row',
          summary: 'Add a row',
          parameters: [
            { name: 'title', in: 'body', type: 'string', description: '', required: true },
            { name: 'details', in: 'body', type: 'string', description: '', required: false, format: 'long-text' },
            { name: 'priority', in: 'body', type: 'string', description: '', required: false, enum: ['low', 'normal', 'high'], default: 'normal' },
            { name: 'due', in: 'body', type: 'string', description: '', required: false, format: 'date' },
            { name: 'urgent', in: 'body', type: 'boolean', description: '', required: false },
            { name: 'hours', in: 'body', type: 'number', description: '', required: false },
          ],
        },
        {
          name: 'PATCH rows',
          method: 'PATCH',
          endPoint: 'tables/t/rows/{id}',
          responseType: 'Row',
          summary: 'Change fields of a row',
          parameters: [
            { name: 'id', in: 'path', type: 'string', description: '', required: true },
            { name: 'title', in: 'body', type: 'string', description: '', required: false },
            { name: 'details', in: 'body', type: 'string', description: '', required: false, format: 'long-text' },
            { name: 'priority', in: 'body', type: 'string', description: '', required: false, enum: ['low', 'normal', 'high'] },
            { name: 'due', in: 'body', type: 'string', description: '', required: false, format: 'date' },
            { name: 'urgent', in: 'body', type: 'boolean', description: '', required: false },
            { name: 'hours', in: 'body', type: 'number', description: '', required: false },
          ],
        },
        {
          name: 'DELETE rows',
          method: 'DELETE',
          endPoint: 'tables/t/rows/{id}',
          summary: 'Delete a row',
          parameters: [{ name: 'id', in: 'path', type: 'string', description: '', required: true }],
        },
      ],
      schemas: {
        Row: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Title' },
            details: { type: 'string', description: 'Details', format: 'long-text' },
            priority: { type: 'string', description: 'Priority', enum: ['low', 'normal', 'high'] },
            due: { type: 'string', description: 'Due', format: 'date' },
            urgent: { type: 'boolean', description: 'Urgent' },
            hours: { type: 'number', description: 'Hours' },
          },
          required: ['title'],
        },
        Rows: { type: 'array', items: { $ref: 'Row' } },
      },
      table: {
        key: 't',
        schema: {
          fields: [
            { name: 'title', type: 'text', required: true },
            { name: 'details', type: 'long-text', required: false },
            { name: 'priority', type: 'choice', required: false, options: ['low', 'normal', 'high'], default: 'normal' },
            { name: 'due', type: 'date', required: false },
            { name: 'urgent', type: 'yes-no', required: false },
            { name: 'hours', type: 'number', required: false },
          ],
        },
        // Sample rows are stored as the fields say: typed, with defaults.
        sampleRows: [{ title: 'Paint the hall', priority: 'normal', hours: 3 }],
      },
    })
  })

  it("leaves out sample rows that don't fit, and fields it can't read, saying why", () => {
    const { result, problems } = run({
      fields: [...FIELDS, 'size: huge'],
      sample_rows: '[{"title": "ok"}, {"details": "no title"}, {"title": "x", "priority": "urgent"}, 3]',
    })
    expect(problems).toEqual([
      `t: size: "huge" isn't a type (text, long text, number, date, choice or yes/no)`,
      't: 1 sample row(s) are not objects and were left out',
      't: Sample row 2 is left out: title is required',
      't: Sample row 3 is left out: priority must be one of low, normal, high',
    ])
    expect((result.exports.get('t') as { table: { sampleRows: unknown[] } }).table.sampleRows).toEqual([{ title: 'ok', priority: 'normal' }])
  })

  it('requires in its row schema what a new row must give, so not a required field with a default', () => {
    const { result } = run({ fields: ['title: text, required', 'status: choice open | done, required, default open'] })
    const exports = result.exports.get('t') as { schemas: { Row: { required: string[] } } }
    expect(exports.schemas.Row.required).toEqual(['title'])
  })

  it("is the only resource whose rows' address counts: typed into a Data Resource, it is no address", () => {
    const typed = inst('DataResourceFeature', 'r', { name: 'Typed', resource: 'tables/t/rows', operation: 'GET' }, null)
    const r = generate(
      model(table(), typed, page(), inst('TableFeature', 'x', { data_resource: 'r' }), inst('FormFeature', 'f', { data_resource: 'r', operation: '' })),
    )
    expect(r.diagnostics.map((d) => `${d.featureInstanceId}: ${d.message}`)).toEqual([
      'x: Operation "GET tables/t/rows" of Typed has no http(s) URL',
      'f: Typed has no POST or PUT operation to send to',
    ])
  })

  it('lets a Form change a row with PATCH', () => {
    const { nodes, problems } = run({}, inst('FormFeature', 'f', { data_resource: 't', operation: 'PATCH rows', fields: ['id', 'title'] }))
    expect(problems).toEqual([])
    expect((nodes[0] as DocNodeOf<'form'>).props.action).toMatchObject({ method: 'PATCH', endPoint: 'tables/t/rows/{id}' })
  })

  it('warns when it has no fields', () => {
    expect(run({ fields: [] }).problems).toEqual(['t: The table has no fields: list them in Fields, like "name: text, required"'])
  })

  it("offers no operations when its id can't be part of an address", () => {
    const r = generate(model(table({}, 'a/b'), page()))
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      `The table's id "a/b" can't name where its rows are kept; give it an id of letters, digits, "_" or "-"`,
    ])
  })

  it('feeds a Table: its rows, its fields as columns, and a row delete', () => {
    const { nodes, problems } = run({}, inst('TableFeature', 'x', { data_resource: 't', delete_operation: 'DELETE rows' }))
    expect(problems).toEqual([])
    expect((nodes[0] as DocNodeOf<'table'>).props).toEqual({
      source: { feature: 't', resource: 'Requests', operation: 'GET rows', endPoint: 'tables/t/rows' },
      columns: [
        { field: 'title', label: 'Title' },
        { field: 'details', label: 'Details' },
        { field: 'priority', label: 'Priority' },
        { field: 'due', label: 'Due' },
        { field: 'urgent', label: 'Urgent' },
        { field: 'hours', label: 'Hours' },
      ],
      deleteAction: { feature: 't', resource: 'Requests', operation: 'DELETE rows', method: 'DELETE', endPoint: 'tables/t/rows/{id}' },
    })
  })

  it('feeds a Form: a field per table field, of the right kind, sending a new row', () => {
    const { nodes, problems } = run({}, inst('FormFeature', 'f', { data_resource: 't' }))
    expect(problems).toEqual([])
    const props = (nodes[0] as DocNodeOf<'form'>).props
    expect(props.action).toEqual({ feature: 't', resource: 'Requests', operation: 'POST rows', method: 'POST', endPoint: 'tables/t/rows' })
    expect(props.fields).toEqual([
      { name: 'title', label: 'Title', type: 'text', required: true, in: 'body' },
      { name: 'details', label: 'Details', type: 'long-text', required: false, in: 'body' },
      { name: 'priority', label: 'Priority', type: 'choice', required: false, in: 'body', options: ['low', 'normal', 'high'], default: 'normal' },
      { name: 'due', label: 'Due', type: 'date', required: false, in: 'body' },
      { name: 'urgent', label: 'Urgent', type: 'yes-no', required: false, in: 'body' },
      { name: 'hours', label: 'Hours', type: 'number', required: false, in: 'body' },
    ])
  })

  it("lets a Form's Fields pick some, keeping what each takes", () => {
    const { nodes } = run({}, inst('FormFeature', 'f', { data_resource: 't', fields: ['title', 'priority', 'note'], labels: ['', 'How urgent'] }))
    expect((nodes[0] as DocNodeOf<'form'>).props.fields).toEqual([
      { name: 'title', label: 'Title', type: 'text', required: true, in: 'body' },
      { name: 'priority', label: 'How urgent', type: 'choice', required: false, in: 'body', options: ['low', 'normal', 'high'], default: 'normal' },
      { name: 'note', label: 'Note', type: 'text', required: false, in: 'body' },
    ])
  })

  it('feeds a Text (its whole answer, e.g. the count) and a Chart', () => {
    const { nodes, problems } = run(
      {},
      inst('TextFeature', 'c', { text: '{{length}} requests', data_resource: 't' }),
      inst('GoogleChartFeature', 'g', { data_resource: 't', label_field: 'title', value_field: 'hours' }),
    )
    expect(problems).toEqual([])
    expect((nodes[0] as DocNodeOf<'text'>).props.data?.source).toEqual({ feature: 't', resource: 'Requests', operation: 'GET rows', endPoint: 'tables/t/rows' })
    expect((nodes[1] as DocNodeOf<'chart'>).props.source).toEqual({ feature: 't', resource: 'Requests', operation: 'GET rows', endPoint: 'tables/t/rows' })
  })

  it("is never fetched through the proxy, and renaming it keeps its rows' address", () => {
    expect(proxyAddresses(model(table(), page()))).toEqual([])
    const renamed = generate(model(table({ name: 'Tickets' }), page()))
    expect((renamed.exports.get('t') as { operations: { endPoint: string }[] }).operations[0]!.endPoint).toBe('tables/t/rows')
  })
})
