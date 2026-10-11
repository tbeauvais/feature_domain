import { describe, expect, it } from 'vitest'
import { defaultOperation, generate, MAX_FORM_FIELDS, migrate, readApiSpec, type DataOperation, type DocNodeOf, type ReadSpec } from '../src'
import { inst, model, page } from './helpers'

const people = inst('DataResourceFeature', 'r', { name: 'People', source: 'sample', sample_rows: '[{"name": "Ada", "projects": 3}]' }, null)
const spec = {
  openapi: '3.0.3',
  servers: [{ url: 'https://pets.test' }],
  paths: {
    '/pets': {
      get: {},
      post: {
        requestBody: { content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', properties: { name: { type: 'string', description: 'What to call it' }, age: { type: 'integer' } } } } } },
      },
    },
    '/pets/{id}': { put: { parameters: [{ name: 'id', in: 'path', required: true }, { name: 'X-Key', in: 'header' }], requestBody: { content: { 'application/json': { schema: { properties: { name: { type: 'string' } } } } } } } },
  },
}
const pets = inst('SwaggerDataResourceFeature', 's', { name: 'Pets', spec: JSON.stringify(spec) }, null)

const formOf = (resource: ReturnType<typeof inst>, inputs: Record<string, unknown>) => {
  const r = generate(model(resource, page(), inst('FormFeature', 'f', { data_resource: resource.id, ...inputs } as never)))
  return { props: (r.root.children[0]!.children[0] as DocNodeOf<'form'>).props, problems: r.diagnostics.map((d) => d.message) }
}

describe('FormFeature', () => {
  it('on sample data, takes its fields from the rows (numbers as number fields) and adds rows', () => {
    const { props, problems } = formOf(people, {})
    expect(problems).toEqual([])
    expect(props).toEqual({
      fields: [
        { name: 'name', label: 'Name', type: 'text', required: false, in: 'body' },
        { name: 'projects', label: 'Projects', type: 'number', required: false, in: 'body' },
      ],
      submit: 'Submit',
      success: 'Thanks, that was sent.',
      action: { feature: 'r', resource: 'People', operation: 'POST rows', method: 'POST', endPoint: '', sample: true },
    })
  })

  it('with a spec, takes the operation\'s inputs: path parameters, body fields (not headers), types, hints and the encoding', () => {
    const post = formOf(pets, {}).props
    expect(post.action).toEqual({ feature: 's', resource: 'Pets', operation: 'POST /pets', method: 'POST', endPoint: 'https://pets.test/pets', requestType: 'form' })
    expect(post.fields).toEqual([
      { name: 'name', label: 'Name', type: 'text', required: false, in: 'body', hint: 'What to call it' },
      { name: 'age', label: 'Age', type: 'number', required: false, in: 'body' },
    ])
    const put = formOf(pets, { operation: 'PUT /pets/{id}' }).props
    expect(put.action).toMatchObject({ method: 'PUT', endPoint: 'https://pets.test/pets/{id}' })
    expect(put.action).not.toHaveProperty('requestType')
    expect(put.fields.map((f) => [f.name, f.in, f.required])).toEqual([
      ['id', 'path', true],
      ['name', 'body', false],
    ])
  })

  it('tells sample data how its rows are numbered, so an added row gets the next id', () => {
    const numbered = (rows: unknown[]) => formOf(inst('DataResourceFeature', 'n', { name: 'N', source: 'sample', sample_rows: JSON.stringify(rows) }, null), {}).props.action?.sampleIds
    expect(numbered([{ id: '1', name: 'a' }, { id: '5', name: 'b' }])).toEqual({ field: 'id', after: 5, text: true })
    expect(numbered([{ id: 2 }, { id: 9 }])).toEqual({ field: 'id', after: 9, text: false })
    expect(numbered([{ order_id: 7, total: 1 }])).toEqual({ field: 'order_id', after: 7, text: false })
    // No id, ids that aren't whole numbers, or rows missing it: nothing to number.
    for (const rows of [[{ name: 'a' }], [{ id: 'abc' }], [{ id: 1 }, { name: 'no id' }], []]) expect(numbered(rows)).toBeUndefined()
  })

  it('requires what the spec\'s request schema requires, plus its own Required fields, warning about ones not in the form', () => {
    const strict = { ...spec, paths: { '/pets': { post: { requestBody: { content: { 'application/json': { schema: { required: ['name'], properties: { name: { type: 'string' }, age: { type: 'integer' } } } } } } } } } }
    const s = inst('SwaggerDataResourceFeature', 's', { spec: JSON.stringify(strict) }, null)
    expect(formOf(s, {}).props.fields.map((f) => [f.name, f.required])).toEqual([
      ['name', true],
      ['age', false],
    ])
    const own = formOf(s, { required_fields: ['age', 'color'] })
    expect(own.props.fields.map((f) => [f.name, f.required])).toEqual([
      ['name', true],
      ['age', true],
    ])
    expect(own.problems).toEqual(['Required field "color" is not in the form'])
  })

  it('uses its own fields and labels when given, and its own button text and message', () => {
    const { props } = formOf(people, { fields: ['email', 'note'], labels: ['Your email'], submit_label: 'Sign up', success_message: 'See you there!' })
    expect(props).toMatchObject({
      fields: [
        { name: 'email', label: 'Your email', type: 'text' },
        { name: 'note', label: 'Note', type: 'text' },
      ],
      submit: 'Sign up',
      success: 'See you there!',
    })
  })

  it('says what is wrong instead of sending somewhere it shouldn\'t', () => {
    expect(formOf(people, { operation: 'GET rows' })).toMatchObject({ problems: ['"GET rows" doesn\'t take data; a form sends with POST or PUT'] })
    expect(formOf(people, { operation: 'GET rows' }).props).not.toHaveProperty('action')
    expect(formOf(people, { operation: 'POST /gone' }).problems).toEqual(['Operation "POST /gone" is not provided by People'])
    const readOnly = inst('DataResourceFeature', 'g', { name: 'Feed', resource: 'https://x.test/feed' }, null)
    expect(formOf(readOnly, {}).problems).toEqual(['Feed has no POST or PUT operation to send to'])
    const many = formOf(people, { fields: Array.from({ length: MAX_FORM_FIELDS + 2 }, (_, i) => `f${i}`) })
    expect(many.props.fields).toHaveLength(MAX_FORM_FIELDS)
    expect(many.problems).toEqual([`Only the first ${MAX_FORM_FIELDS} of ${MAX_FORM_FIELDS + 2} fields are shown`])
  })

  it('records a form-encoded or multipart request body in the spec', () => {
    const r = readApiSpec(spec) as ReadSpec
    expect(r.operations.find((o) => o.name === 'POST /pets')!.requestType).toBe('form')
    expect(r.operations.find((o) => o.name === 'PUT /pets/{id}')!.requestType).toBeUndefined()
    const multipart = { ...spec, paths: { '/photos': { post: { requestBody: { content: { 'multipart/form-data': { schema: { properties: { caption: { type: 'string' } } } } } } } } } }
    expect((readApiSpec(multipart) as ReadSpec).operations[0]!.requestType).toBe('multipart')
  })

  it('with no operation chosen, sends to the first POST even when a PUT comes before it, as the inspector says', () => {
    const putFirst = { ...spec, paths: { '/pets/{id}': spec.paths['/pets/{id}'], '/pets': spec.paths['/pets'] } }
    const s = inst('SwaggerDataResourceFeature', 's', { name: 'Pets', spec: JSON.stringify(putFirst) }, null)
    expect(formOf(s, {}).props.action?.operation).toBe('POST /pets')
    const ops = [{ name: 'PUT /a', method: 'PUT' }, { name: 'GET /a', method: 'GET' }, { name: 'POST /a', method: 'POST' }] as DataOperation[]
    expect(defaultOperation(ops, ['POST', 'PUT'])?.name).toBe('POST /a')
    expect(defaultOperation(ops.slice(0, 2), ['POST', 'PUT'])?.name).toBe('PUT /a')
    expect(defaultOperation(ops, ['DELETE'])).toBeUndefined()
  })

  it('warns that a required header parameter can\'t be sent from a form', () => {
    expect(formOf(pets, { operation: 'PUT /pets/{id}' }).problems).toEqual([])
    const keyed = { ...spec, paths: { '/pets': { post: { parameters: [{ name: 'X-Api-Key', in: 'header', required: true }], requestBody: spec.paths['/pets'].post.requestBody } } } }
    const s = inst('SwaggerDataResourceFeature', 's', { spec: JSON.stringify(keyed) }, null)
    expect(formOf(s, {}).problems).toEqual(['"POST /pets" requires the header "X-Api-Key", which a form can\'t send'])
  })
})

describe('migrating the legacy Form', () => {
  it('keeps the resource, operation and its fields and labels, dropping filters with a note', () => {
    const r = migrate({
      features: [
        { feature: 'PageFeature', id: '1', inputs: { name: 'Page', page_location: { target: '#content_section' } } },
        { feature: 'DataResourceFeature', id: '2', inputs: { name: 'Sales', resource: 'https://x.test/sales', operation: 'POST' } },
        { feature: 'FormFeature', id: '3', inputs: { name: 'Add', disable: '', data_resource: { name: 'Sales', operation: 'POST /sales' }, fields: 'name,amount', labels: 'Name,Amount', filters: 'x', page_location: { target: '#page_container' } } },
      ],
    })
    expect(r.model.features[2]!.inputs).toEqual({ name: 'Add', disable: false, data_resource: '2', operation: 'POST /sales', fields: ['name', 'amount'], labels: ['Name', 'Amount'] })
    expect(r.notes.map((n) => n.message)).toContain('Dropped form filters "x", which forms don\'t use')
    // The legacy form ignored its fields (it built itself from the operation), so using them is noted.
    expect(r.notes.map((n) => n.message)).toContain('The form\'s fields are now "name, amount"; the legacy app took them from the operation instead')
  })
})
