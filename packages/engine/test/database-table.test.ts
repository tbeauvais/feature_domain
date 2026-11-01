import { describe, expect, it } from 'vitest'
import {
  databaseTableKeys,
  databaseTables,
  generate,
  isDatabaseTableExports,
  OPEN_ACCESS,
  operationNeedsPerson,
  rowOperation,
  rulesFor,
  proxyAddresses,
  type DocNodeOf,
  type FeatureInstance,
  type InputValue,
} from '../src'
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
        name: 'Requests',
        access: OPEN_ACCESS,
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

  it("lets a Table change a row's choice fields in place with PATCH, each column with its options", () => {
    const table = (inputs: Record<string, InputValue>) => run({}, inst('TableFeature', 'x', { data_resource: 't', update_operation: 'PATCH rows', ...inputs }))
    const every = table({})
    expect(every.problems).toEqual([])
    const props = (every.nodes[0] as DocNodeOf<'table'>).props
    expect(props.updateAction).toEqual({ feature: 't', resource: 'Requests', operation: 'PATCH rows', method: 'PATCH', endPoint: 'tables/t/rows/{id}' })
    expect(props.columns.filter((c) => c.options)).toEqual([{ field: 'priority', label: 'Priority', options: ['low', 'normal', 'high'] }])

    const chosen = table({ fields: ['title', 'priority', 'urgent'], change_fields: ['priority'] })
    expect((chosen.nodes[0] as DocNodeOf<'table'>).props.columns).toEqual([
      { field: 'title', label: 'title' },
      { field: 'priority', label: 'priority', options: ['low', 'normal', 'high'] },
      { field: 'urgent', label: 'urgent' },
    ])
    expect(table({ change_fields: ['title', 'nope'] }).problems).toEqual([
      'x: Changeable field "title" has no options to choose from',
      'x: Changeable field "nope" is not a column of the table',
    ])
  })

  it('changes rows only with a PATCH operation it has, and says why not', () => {
    const put = run({}, inst('TableFeature', 'x', { data_resource: 't', update_operation: 'POST rows' }))
    expect(put.problems).toEqual(['x: "POST rows" doesn\'t change part of a row; rows are changed with PATCH'])
    expect((put.nodes[0] as DocNodeOf<'table'>).props.updateAction).toBeUndefined()
    expect(run({}, inst('TableFeature', 'x', { data_resource: 't', update_operation: 'PATCH gone' })).problems).toEqual([
      'x: Change operation "PATCH gone" is not provided by Requests',
    ])
    expect(run({ fields: ['title: text'] }, inst('TableFeature', 'x', { data_resource: 't', update_operation: 'PATCH rows' })).problems).toEqual([
      'x: No column has options to choose from, so rows have nothing to change',
    ])
  })

  it("doesn't change sample rows in place, nor rows whose columns are only known once they load", () => {
    const spec = {
      openapi: '3.0.3',
      servers: [{ url: 'https://api.test' }],
      paths: {
        '/items': { get: { responses: { 200: { content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } } } },
        '/items/{id}': { patch: {} },
      },
    }
    const sample = inst('SwaggerDataResourceFeature', 's', { name: 'Items', spec: JSON.stringify(spec), source: 'sample' }, null)
    const onSample = generate(model(sample, page(), inst('TableFeature', 'x', { data_resource: 's', fields: ['name'], update_operation: 'PATCH /items/{id}' })))
    expect(onSample.diagnostics.map((d) => d.message)).toContain(`"PATCH /items/{id}" is answered with sample rows, which can't be changed in place`)

    const address = inst('SwaggerDataResourceFeature', 'a', { name: 'Items', spec: JSON.stringify(spec) }, null)
    const later = generate(model(address, page(), inst('TableFeature', 'x', { data_resource: 'a', update_operation: 'PATCH /items/{id}' })))
    expect(later.diagnostics.map((d) => d.message)).toEqual([
      "The table's columns are only known once its rows load, so it has no column with options to change: list them in Fields",
    ])
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

describe('databaseTables', () => {
  it("lists the model's Database tables that generate, by key, with their fields and sample rows", () => {
    const tables = databaseTables(
      model(
        table({ sample_rows: '[{"title": "One"}]' }),
        table({ name: 'Other', fields: ['n: number'] }, 'u'),
        table({}, 'a/b'),
        inst('DataResourceFeature', 'r', {}, null),
        page(),
      ),
    )
    expect([...tables.keys()]).toEqual(['t', 'u'])
    expect(tables.get('t')).toMatchObject({ key: 't', sampleRows: [{ title: 'One', priority: 'normal' }] })
    expect(tables.get('u')?.schema.fields).toEqual([{ name: 'n', type: 'number', required: false }])
  })
})

describe('databaseTableKeys', () => {
  it('lists every Database table, also ones that do not generate', () => {
    expect(databaseTableKeys(model(table(), table({}, 'a/b'), inst('DataResourceFeature', 'r', {}, null), page()))).toEqual(['t', 'a/b'])
  })
})

describe('a Database table’s access rules', () => {
  const signIn = inst('SignInFeature', 's', {}, null)
  const accessOf = (inputs: Record<string, InputValue>, ...others: FeatureInstance[]) => {
    const m = model(table(inputs), ...others)
    return { access: databaseTables(m).get('t')?.access, problems: generate(m).diagnostics.map((d) => `${d.severity}: ${d.message}`) }
  }

  it('are open to anyone by default, so tables stored before rules keep working as they did', () => {
    expect(accessOf({})).toEqual({ access: OPEN_ACCESS, problems: [] })
  })

  it('take a rule per operation, and what a deleted account leaves', () => {
    expect(accessOf({ see_rows: 'signed-in', add_rows: 'signed-in', change_rows: 'owner', delete_rows: 'nobody', deleted_accounts: 'keep' }, signIn)).toEqual({
      access: { see: 'signed-in', add: 'signed-in', change: 'owner', delete: 'nobody', deletedAccounts: 'keep' },
      problems: [],
    })
  })

  it('fail closed on a choice they don’t know, as an error so the app isn’t published (adding has no owner)', () => {
    const { access, problems } = accessOf({ see_rows: 'everyone', add_rows: 'owner', deleted_accounts: 'archive' })
    expect(access).toMatchObject({ see: 'nobody', add: 'nobody', change: 'anyone', deletedAccounts: 'delete' })
    expect(problems).toEqual([
      'error: "everyone" isn\'t a choice of who can see rows: choose one',
      'error: "owner" isn\'t a choice of who can add rows: choose one',
      'error: "archive" isn\'t a choice of what happens to a deleted account\'s rows: choose one',
    ])
  })

  it('need a Sign-in feature when a rule needs someone signed in (else the app would refuse everyone)', () => {
    const missing = 'error: Its rules need people to sign in: add a Sign-in feature, or set them to Anyone or No one'
    expect(accessOf({ delete_rows: 'owner' }).problems).toEqual([missing])
    expect(accessOf({ see_rows: 'signed-in' }, inst('SignInFeature', 's', { disable: true }, null)).problems).toContain(missing)
    expect(accessOf({ delete_rows: 'owner' }, signIn).problems).toEqual([])
    // Anyone and No one need no one signed in.
    expect(accessOf({ see_rows: 'anyone', delete_rows: 'nobody' }).problems).toEqual([])
    // The table still generates (its rows stay readable in the builder).
    expect(databaseTables(model(table({ delete_rows: 'owner' }))).has('t')).toBe(true)
  })

  it('make created_by a name no field can take', () => {
    const r = generate(model(table({ fields: ['created_by: text'] })))
    expect(r.diagnostics.map((d) => d.message)).toContain('"created_by" is set for every row already; name the field something else')
  })
})

describe('which rules an operation answers to', () => {
  it('is its own, and for a change or delete the See rule too', () => {
    const access = { see: 'owner', add: 'anyone', change: 'anyone', delete: 'nobody', deletedAccounts: 'delete' } as const
    expect(rulesFor(access, 'see')).toEqual(['owner'])
    expect(rulesFor(access, 'add')).toEqual(['anyone'])
    expect(rulesFor(access, 'change')).toEqual(['anyone', 'owner'])
    expect(rulesFor(access, 'delete')).toEqual(['nobody', 'owner'])
    expect(operationNeedsPerson(access, 'add')).toBe(false)
    expect(operationNeedsPerson(access, 'change')).toBe(true)
    expect(operationNeedsPerson(OPEN_ACCESS, 'delete')).toBe(false)
    expect(rowOperation('get')).toBe('see')
    expect(rowOperation('PUT')).toBeUndefined()
  })
})
