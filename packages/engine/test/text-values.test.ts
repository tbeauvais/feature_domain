import { describe, expect, it } from 'vitest'
import { generate, migrate, parseBindings, type AppModel } from '../src'
import { inst, model, page, resource } from './helpers'

const sample = (rows: object[]) => inst('DataResourceFeature', 'r', { name: 'People', source: 'sample', sample_rows: JSON.stringify(rows) }, null)
const text = (inputs: Record<string, string>) => {
  const r = generate(model(page(), resource('r', 'Profile', 'https://api.example.com/users/tom'), inst('TextFeature', 't', inputs)))
  return { node: r.root.children[0]!.children[0]!, problems: r.diagnostics.map((d) => d.message) }
}

describe('parseBindings', () => {
  it('splits a text into literal runs and {{path}} values, with an optional table filter', () => {
    expect(parseBindings('Tom has {{ public_repos }} repos, updated {{ 0.updated_at | date }}.')).toEqual([
      { text: 'Tom has ' },
      { path: 'public_repos', binding: '{{ public_repos }}' },
      { text: ' repos, updated ' },
      { path: '0.updated_at', filter: 'date', binding: '{{ 0.updated_at | date }}' },
      { text: '.' },
    ])
  })

  it('keeps empty or unclosed braces as text', () => {
    expect(parseBindings('a {{ }} b {{c')).toEqual([{ text: 'a {{ }} b {{c' }])
    expect(parseBindings('')).toEqual([])
    expect(parseBindings('{{length}}')).toEqual([{ path: 'length', binding: '{{length}}' }])
  })
})

describe('Text with values from data', () => {
  it('reads its {{path}} values from the whole answer of the resource it names', () => {
    const { node, problems } = text({ text: 'Tom has {{public_repos}} repos', data_resource: 'r' })
    expect(problems).toEqual([])
    expect(node.props).toEqual({
      text: 'Tom has {{public_repos}} repos',
      data: {
        source: { feature: 'r', resource: 'Profile', operation: 'GET /users/tom', endPoint: 'https://api.example.com/users/tom' },
        parts: [{ text: 'Tom has ' }, { path: 'public_repos', binding: '{{public_repos}}' }, { text: ' repos' }],
      },
    })
  })

  it('reads sample data as its rows', () => {
    const r = generate(model(page(), sample([{ name: 'Ada' }]), inst('TextFeature', 't', { text: '{{length}} people, first {{0.name}}', data_resource: 'r' })))
    expect(r.diagnostics).toEqual([])
    expect((r.root.children[0]!.children[0]!.props as { data?: unknown }).data).toMatchObject({ source: { feature: 'r', rows: [{ name: 'Ada' }] } })
  })

  it('shows its values as written, and says why, without a usable resource', () => {
    expect(text({ text: 'Tom has {{public_repos}} repos' })).toEqual({
      node: expect.objectContaining({ props: { text: 'Tom has {{public_repos}} repos' } }),
      problems: ['The text has {{…}} values but no Data Resource to read them from, so they show as written'],
    })
    // A resource that went away: the text still shows (a soft reference), with a warning.
    const gone = generate(model(page(), inst('TextFeature', 't', { text: '{{a}}', data_resource: 'missing' })))
    expect(gone.root.children[0]!.children[0]!.props).toEqual({ text: '{{a}}' })
    expect(gone.diagnostics.map((d) => d.severity)).toEqual(['warning'])
    expect(text({ text: 'Plain', data_resource: 'r' }).problems).toEqual(['The text has a Data Resource but no {{…}} values to fill in'])
    expect(text({ text: '{{a}}', data_resource: 'r', operation: 'GET /nope' }).problems).toEqual(['Operation "GET /nope" is not provided by Profile'])
  })

  it('leaves plain texts as they were', () => {
    expect(text({ text: 'Just words' })).toEqual({ node: expect.objectContaining({ props: { text: 'Just words' } }), problems: [] })
  })
})

describe('migrating legacy {{DataResource…}} bindings', () => {
  const loc = { page_location: { target: '#page_container' } }
  const legacy = (texts: string[], resources = [{ id: '21', name: 'Weather Service' }]) =>
    migrate({
      features: [
        { feature: 'PageFeature', id: '1', inputs: { name: 'Page', page_location: { target: '#content_section' } } },
        ...resources.map((r) => ({
          feature: 'DataResourceFeature',
          id: r.id,
          inputs: { name: r.name, resource: `https://api.example.com/${r.id}`, operation: 'GET' },
        })),
        ...texts.map((t, i) => ({ feature: 'TextFeature', id: `t${i}`, inputs: { name: 'Text', text: t, ...loc } })),
      ],
    })

  it('point the text at the resource they name (its name without spaces) and become {{path}} values', () => {
    const r = legacy(['Temp {{DataResource.WeatherService.query.temp}} degrees, {{ DataResource.WeatherService.query.when | date }}'])
    expect(r.model.features.at(-1)!.inputs).toEqual({
      name: 'Text',
      disable: false,
      text: 'Temp {{query.temp}} degrees, {{query.when | date}}',
      data_resource: '21',
    })
    expect(r.notes.map((n) => [n.code, n.message])).toEqual([
      ['mapped-input', "The text's {{DataResource.WeatherService…}} values read data resource 21 now, as {{path}}"],
    ])
  })

  it('stay as written, with a warning, when they read several resources, an unknown one, or anything else', () => {
    const r = legacy(
      ['{{DataResource.A.x}} {{DataResource.B.y}}', '{{DataResource.Nope.x}}', '{{ 1 + 1 }}', '{{DataResource.A}}'],
      [
        { id: '21', name: 'A' },
        { id: '22', name: 'B' },
      ],
    )
    for (const f of r.model.features.filter((f) => f.feature === 'TextFeature')) expect(f.inputs.data_resource, String(f.inputs.text)).toBeUndefined()
    expect(r.notes.map((n) => n.code)).toEqual(['data-binding', 'data-binding', 'data-binding', 'data-binding'])
  })
})

describe('upgrading stored Texts that still hold legacy bindings', () => {
  const stored = (text: string, extra: Record<string, string> = {}): AppModel => ({
    version: 2,
    name: 'Stored',
    features: [
      { feature: 'PageFeature', id: '1', inputs: { name: 'Page' }, placement: { parent: '$root', slot: 'content' } },
      { feature: 'DataResourceFeature', id: '21', inputs: { name: 'Weather Service', resource: 'https://api.example.com/w', operation: 'GET' } },
      { feature: 'TextFeature', id: '2', inputs: { name: 'Text', text, ...extra }, placement: { parent: '1', slot: 'content' } },
    ],
  })

  it("points them at the resource they name, as a legacy model's would be, once", () => {
    const r = migrate(stored('Temp {{DataResource.WeatherService.query.temp}} degrees'))
    expect(r.model.features[2]!.inputs).toEqual({ name: 'Text', text: 'Temp {{query.temp}} degrees', data_resource: '21' })
    expect(r.notes.map((n) => `${n.code}:${n.featureInstanceId}`)).toEqual(['mapped-input:2'])
    expect(migrate(r.model).model).toBe(r.model)
  })

  it("returns the same model for bindings it can't map, or a Text that already has a resource", () => {
    for (const m of [stored('{{DataResource.Nope.x}}'), stored('{{DataResource.WeatherService.x}}', { data_resource: '21' }), stored('No bindings')]) {
      expect(migrate(m)).toEqual({ model: m, notes: [] })
      expect(migrate(m).model).toBe(m)
    }
  })
})

describe('Text value warnings', () => {
  it("warn about a filter the renderer doesn't know, and talk about values, not rows", () => {
    expect(text({ text: '{{a | date}} {{b | shout}} {{c | currency :EUR}}', data_resource: 'r' }).problems).toEqual([
      '{{b | shout}} names an unknown filter "shout"; the value shows unfiltered',
    ])
    const r = generate(
      model(
        page(),
        inst('DataResourceFeature', 'r', { name: 'Adder', resource: 'https://api.example.com/x', operation: 'POST' }, null),
        inst('TextFeature', 't', { text: '{{a}}', data_resource: 'r' }),
      ),
    )
    expect(r.diagnostics.map((d) => d.message)).toEqual(['Adder has no GET operation to read values from'])
  })

  it('give the syntax with the Data Resource, not under the Text itself (a plain text isn’t told about data)', async () => {
    const { TextFeature } = await import('../src')
    expect(TextFeature.inputs.find((i) => i.name === 'text')!.hint).toBeUndefined()
    expect(TextFeature.inputs.find((i) => i.name === 'data_resource')!.hint).toBe(
      'Then write {{field}} in the Text to show a value from it: {{length}} counts the rows, {{0.title}} is the first row’s title, {{0.due | date}} shows a date.',
    )
  })
})
