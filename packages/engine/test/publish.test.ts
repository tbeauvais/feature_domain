import { describe, expect, it } from 'vitest'
import { builderAddresses, databaseTables, diffSchemas, MAX_SLUG_LENGTH, RESERVED_SLUGS, slugProblem, suggestSlug } from '../src'
import { inst, model, page } from './helpers'

describe('slugProblem', () => {
  it('takes lowercase letters, digits and single hyphens, 3 to 40 long', () => {
    for (const ok of ['requests', 'team-requests', 'abc', 'a1-b2-c3', '2026-offsite', 'x'.repeat(MAX_SLUG_LENGTH)]) expect(slugProblem(ok), ok).toBeUndefined()
  })

  it('says what is wrong with anything else', () => {
    expect(slugProblem('ab')).toBe('An address name is 3 to 40 characters long')
    expect(slugProblem('x'.repeat(MAX_SLUG_LENGTH + 1))).toBe('An address name is 3 to 40 characters long')
    for (const bad of ['Team', 'team_requests', 'team requests', 'café', 'a.b.c'])
      expect(slugProblem(bad), bad).toBe('An address name uses only lowercase letters, digits and hyphens')
    expect(slugProblem('-team')).toBe("An address name can't start or end with a hyphen")
    expect(slugProblem('team-')).toBe("An address name can't start or end with a hyphen")
    // Also keeps out punycode ("xn--…"), which browsers would show as another name.
    expect(slugProblem('xn--caf-dma')).toBe("An address name can't have two hyphens in a row")
  })

  it('keeps names that read as the site itself', () => {
    for (const reserved of ['www', 'api', 'app', 'admin', 'login', 'mcp']) {
      expect(RESERVED_SLUGS.has(reserved)).toBe(true)
      expect(slugProblem(reserved)).toBe(`"${reserved}" is kept for the site itself`)
    }
  })

  it('reserves only names that are valid slugs, so each is kept for that reason', () => {
    for (const reserved of RESERVED_SLUGS) expect(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(reserved) && reserved.length >= 3, reserved).toBe(true)
  })
})

describe('suggestSlug', () => {
  it("makes a valid slug from a model's name", () => {
    expect(suggestSlug('Team requests')).toBe('team-requests')
    expect(suggestSlug('  Tom Beauvais · projects ')).toBe('tom-beauvais-projects')
    expect(suggestSlug('Café Crème')).toBe('cafe-creme')
    expect(suggestSlug('Q4 -- budget!!')).toBe('q4-budget')
  })

  it('cuts a long name without leaving a hyphen at the end', () => {
    const slug = suggestSlug('The quarterly planning board for the whole studio team')
    expect(slug).toBe('the-quarterly-planning-board-for-the')
    expect(slugProblem(slug)).toBeUndefined()
  })

  it('puts "app-" in front of a name too short or kept, and has a fallback for a name with no letters', () => {
    expect(suggestSlug('Hi')).toBe('app-hi')
    expect(suggestSlug('Admin')).toBe('app-admin')
    expect(suggestSlug('日本')).toBe('my-app')
    expect(suggestSlug('')).toBe('my-app')
  })

  it('always suggests a valid slug', () => {
    for (const name of ['Team requests', 'a', '---', 'x'.repeat(100), 'WWW', 'A  B  C', 'résumé 2026', `${'a'.repeat(39)}-b`])
      expect(slugProblem(suggestSlug(name)), name).toBeUndefined()
  })
})

const table = (fields: string[], id = 't') => inst('DatabaseTableFeature', id, { name: `Table ${id}`, fields }, null)
const tables = (...features: ReturnType<typeof table>[]) => databaseTables(model(...features))
const draft = (...features: ReturnType<typeof table>[]) => model(...features)

describe('diffSchemas', () => {
  const published = tables(
    table(['title: text, required', 'details: long text', 'status: choice open | in progress | done, default open', 'due: date', 'hours: number']),
    table(['name: text'], 'old'),
  )

  it('finds nothing when the tables are the same, or only add tables, fields and options', () => {
    const same = draft(
      table(['title: text, required', 'details: long text', 'status: choice open | in progress | done, default open', 'due: date', 'hours: number']),
      table(['name: text'], 'old'),
    )
    expect(diffSchemas(published, same)).toEqual([])
    const added = draft(
      table([
        'title: text, required',
        'details: long text',
        'status: choice open | in progress | blocked | done, default open',
        'due: date',
        // Required now, but its default fills new rows in.
        'hours: number, required, default 0',
        'owner: text',
      ]),
      table(['name: text', 'email: text'], 'old'),
      table(['x: text'], 'new'),
    )
    expect(diffSchemas(published, added)).toEqual([])
  })

  it('lists removed tables and fields, changed types, newly required fields and removed options, in order', () => {
    const changed = draft(table(['title: text, required', 'status: choice open | done, required', 'due: text', 'hours: number, required']))
    expect(diffSchemas(published, changed)).toEqual([
      { kind: 'removed-field', table: 't', field: 'details' },
      { kind: 'newly-required', table: 't', field: 'status' },
      { kind: 'removed-options', table: 't', field: 'status', options: ['in progress'] },
      { kind: 'changed-type', table: 't', field: 'due', from: 'date', to: 'text' },
      { kind: 'newly-required', table: 't', field: 'hours' },
      { kind: 'removed-table', table: 'old' },
    ])
  })

  it('reports a field whose type changed only for its type', () => {
    const retyped = draft(
      table(['title: text, required', 'details: long text', 'status: text, required', 'due: date', 'hours: number']),
      table(['name: text'], 'old'),
    )
    expect(diffSchemas(published, retyped)).toEqual([{ kind: 'changed-type', table: 't', field: 'status', from: 'choice', to: 'text' }])
  })

  it("doesn't count a table that is still in the draft but doesn't generate as removed: it keeps its rows", () => {
    const current = table([
      'title: text, required',
      'details: long text',
      'status: choice open | in progress | done, default open',
      'due: date',
      'hours: number',
    ])
    // A feature listed first under the same id wins, so the table "old" doesn't generate (a problem to fix), but is kept.
    const broken = model(current, page(), inst('TextFeature', 'old', { text: 'Hi' }), table(['name: text'], 'old'))
    expect(databaseTables(broken).has('old')).toBe(false)
    expect(diffSchemas(published, broken)).toEqual([])
    expect(diffSchemas(published, draft(current))).toEqual([{ kind: 'removed-table', table: 'old' }])
  })
})

describe('builderAddresses', () => {
  const MODELS = inst('DataResourceFeature', 'm', { name: 'Models', resource: '/api/v1/models', operation: 'GET' }, null)
  const CREATE = inst('DataResourceFeature', 'c', { name: 'New model', resource: '/api/v1/models', operation: 'POST' }, null)
  const ELSEWHERE = inst('DataResourceFeature', 'e', { name: 'Repos', resource: 'https://api.example.com/repos', operation: 'GET' }, null)

  it('finds links, forms and table links to builder pages, and data read from the models API', () => {
    const found = builderAddresses(
      model(
        MODELS,
        CREATE,
        ELSEWHERE,
        page(),
        inst('LinkFeature', 'l1', { text: 'All models', href: '/models' }),
        inst('LinkFeature', 'l2', { text: 'Top', href: '/#top' }),
        inst('LinkFeature', 'l3', { text: 'Elsewhere', href: 'https://example.com/models/1' }),
        inst('ButtonFeature', 'b', { text: 'Preview', href: '/preview.html?model=7' }),
        inst('FormFeature', 'f', { data_resource: 'c', fields: ['name'], open_after: '/models/{id}' }),
        inst('TableFeature', 't', { data_resource: 'm', fields: ['name', 'url'], filters: ['dataLink :/models/{id}', 'dataLink :url'], delete_operation: '' }),
        inst('TableFeature', 'r', { data_resource: 'e', fields: ['name'], filters: ['dataLink :/repos/{name}'] }),
        // No Fields of its own and no spec: its filters apply by position once rows load.
        inst('TableFeature', 'p', { data_resource: 'e', filters: ['', 'dataLink :/models/{id}'] }),
        // Templates to other sites, or to the app's own page, stay in reach.
        inst('TableFeature', 'x', { data_resource: 'e', fields: ['name', 'id'], filters: ['dataLink :https://github.com/{name}', 'dataLink :/?id={id}'] }),
        inst('LinkFeature', 'off', { text: 'Hidden', href: '/models/2', disable: true }),
      ),
    )
    expect(found).toEqual([
      { feature: 'l1', kind: 'link', address: '/models' },
      { feature: 'b', kind: 'link', address: '/preview.html?model=7' },
      { feature: 'f', kind: 'data', address: '/api/v1/models' },
      { feature: 'f', kind: 'then-open', address: '/models/{id}' },
      { feature: 't', kind: 'data', address: '/api/v1/models' },
      { feature: 't', kind: 'data-link', address: '/models/{id}' },
      { feature: 'r', kind: 'data-link', address: '/repos/{name}' },
      { feature: 'p', kind: 'data-link', address: '/models/{id}' },
    ])
  })

  it('finds nothing in a model that only links out and reads its own tables', () => {
    const requests = table(['title: text, required'])
    expect(
      builderAddresses(
        model(
          requests,
          page(),
          inst('LinkFeature', 'l', { text: 'Home', href: '/' }),
          inst('FormFeature', 'f', { data_resource: 't', open_after: 'https://example.com/thanks' }),
          inst('TableFeature', 'tb', { data_resource: 't' }),
        ),
      ),
    ).toEqual([])
  })
})
