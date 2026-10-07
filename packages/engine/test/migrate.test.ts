import { describe, expect, it } from 'vitest'
import { generate, migrate, ROOT_ID, type AppModel, type FeatureInstance } from '../src'
import { legacyDomId, legacyGrid, normalizeAlign, normalizeTone } from '../src/migrate/legacy'
import { deepFreeze } from './helpers'

type Legacy = { feature: string; id: string | number; inputs?: Record<string, unknown>; [k: string]: unknown }
const loc = (target: string) => ({ page_location: { name: 'Page 1', target } })
const legacyPage: Legacy = { feature: 'PageFeature', id: '15', inputs: { name: 'Page', ...loc('#content_section') } }

const run = (...features: Legacy[]) => migrate({ id: 'm1', name: 'Legacy', features })
const feature = (r: ReturnType<typeof migrate>, id: string): FeatureInstance => r.model.features.find((f) => f.id === id)!
const notes = (r: ReturnType<typeof migrate>) => r.notes.map((n) => `${n.code}:${n.featureInstanceId ?? ''}`)

describe('migrate: model shape', () => {
  it('returns v2 models unchanged', () => {
    const v2 = deepFreeze({ version: 2 as const, name: 'x', features: [] })
    expect(migrate(v2)).toEqual({ model: v2, notes: [] })
    expect(migrate(v2).model).toBe(v2)
  })

  it('accepts a bare legacy feature list', () => {
    expect(migrate([legacyPage]).model).toMatchObject({ version: 2, name: 'Untitled', features: [{ id: '15' }] })
  })

  it('keeps the model id and name', () => {
    expect(run(legacyPage).model).toMatchObject({ version: 2, id: 'm1', name: 'Legacy' })
  })

  it('rejects input that is not a model', () => {
    expect(() => migrate('nope')).toThrow(TypeError)
    expect(() => migrate({ features: 3 })).toThrow(TypeError)
  })

  it('is idempotent', () => {
    const once = run(legacyPage, { feature: 'TextFeature', id: 2, inputs: { name: 'x', text: 'hi', ...loc('#page_container') } }).model
    expect(migrate(once).model).toBe(once)
  })

  it('does not mutate its input', () => {
    expect(() => migrate(deepFreeze({ features: [legacyPage, { feature: 'TextFeature', id: 2, inputs: loc('#page_container') }] }))).not.toThrow()
  })

  it('drops AngularJS and legacy editor fields, stringifies ids, and skips malformed or duplicate entries', () => {
    const r = migrate({ features: [legacyPage, { feature: 'TextFeature', id: 2, template: 'x', $$hashKey: 'object:1', inputs: loc('#page_container') }, { nope: 1 }, { ...legacyPage }] })
    expect(feature(r, '2')).toEqual({ feature: 'TextFeature', id: '2', inputs: { name: '', disable: false, text: '' }, placement: { parent: '15', slot: 'content' } })
    expect(notes(r)).toEqual(['skipped-entry:', 'duplicate-id:15'])
  })
})

describe('migrate: placement', () => {
  const container = (id: string, name: unknown, rows: unknown = '1', columns: unknown = '2', target = '#page_container'): Legacy => ({
    feature: 'ContainerFeature',
    id,
    inputs: { name, rows, columns, ...loc(target) },
  })
  const text = (id: string, target: string): Legacy => ({ feature: 'TextFeature', id, inputs: { name: `t${id}`, text: '', ...loc(target) } })

  it('maps legacy DOM-id targets to parent ids and slot keys', () => {
    const r = run(
      legacyPage,
      container('12', 'My Container'),
      { feature: 'PanelFeature', id: '36', inputs: { name: 'repo panel', heading: 'Repos', ...loc('#page_container') } },
      text('1', '#container_my_container_12_row_1_col_2'),
      text('2', '#repo_panel_36_panel'),
      text('3', '#content_section'),
    )
    expect(r.model.features.map((f) => [f.id, f.placement])).toEqual([
      ['15', { parent: ROOT_ID, slot: 'content' }],
      ['12', { parent: '15', slot: 'content' }],
      ['36', { parent: '15', slot: 'content' }],
      ['1', { parent: '12', slot: 'r1c2' }],
      ['2', { parent: '36', slot: 'body' }],
      ['3', { parent: ROOT_ID, slot: 'content' }],
    ])
    expect(r.notes).toEqual([])
  })

  it('resolves targets of containers with empty or missing names, as the legacy app named them', () => {
    const r = run(legacyPage, container('5', ''), container('6', undefined), text('a', '#container__5_row_1_col_1'), text('b', '#container_undefined_6_row_1_col_2'))
    expect(feature(r, 'a').placement).toEqual({ parent: '5', slot: 'r1c1' })
    expect(feature(r, 'b').placement).toEqual({ parent: '6', slot: 'r1c2' })
  })

  it('leaves features with unknown or missing targets unplaced, with a note', () => {
    const r = run(legacyPage, text('a', '#nowhere'), { feature: 'TextFeature', id: 'b', inputs: { text: '' } })
    expect(feature(r, 'a').placement).toBeUndefined()
    expect(r.notes.map((n) => `${n.featureInstanceId}: ${n.message}`)).toEqual([
      'a: Legacy target "#nowhere" does not exist; feature left unplaced',
      'b: No legacy page_location; feature left unplaced',
    ])
  })

  it('places children in the first of two pages, as the legacy app did', () => {
    const r = run(legacyPage, { ...legacyPage, id: '16' }, text('a', '#page_container'))
    expect(feature(r, 'a').placement).toEqual({ parent: '15', slot: 'content' })
    expect(notes(r)).toEqual(['duplicate-target:16'])
  })

  it('never places data resources', () => {
    const r = run(legacyPage, { feature: 'DataResourceFeature', id: '34', inputs: { name: 'R', resource: 'https://x', operation: 'get', ...loc('#page_container') } })
    expect(feature(r, '34')).toEqual({ feature: 'DataResourceFeature', id: '34', inputs: { name: 'R', resource: 'https://x', operation: 'GET' } })
    expect(r.notes).toEqual([])
  })

  it('produces models that generate without placement problems', () => {
    const r = run(legacyPage, container('12', 'Grid'), text('1', '#container_grid_12_row_1_col_1'))
    expect(generate(r.model).diagnostics).toEqual([])
  })

  it('keeps placement through a rename after migration', () => {
    const { model } = run(legacyPage, container('12', 'Grid'), text('1', '#container_grid_12_row_1_col_1'))
    const renamed = { ...model, features: model.features.map((f) => (f.id === '12' ? { ...f, inputs: { ...f.inputs, name: 'Renamed' } } : f)) }
    expect(generate(renamed).metadata.features.find((f) => f.id === '1')?.status).toBe('generated')
  })
})

describe('migrate: values reproduce legacy rendering', () => {
  const one = (feature: string, inputs: Record<string, unknown>) => run(legacyPage, { feature, id: 'x', inputs: { ...inputs, ...loc('#page_container') } })

  it('suppresses only on boolean true, noting string "true"', () => {
    expect(feature(one('TextFeature', { disable: true }), 'x').inputs.disable).toBe(true)
    const r = one('TextFeature', { disable: 'true' })
    expect(feature(r, 'x').inputs.disable).toBe(false)
    expect(notes(r)).toEqual(['coerced-value:x'])
    expect(notes(one('TextFeature', { disable: '' }))).toEqual([])
  })

  it('uses JavaScript truthiness for other booleans, noting false-looking strings', () => {
    const r = one('ContainerFeature', { rows: 1, columns: 1, well: 'false' })
    expect(feature(r, 'x').inputs.well).toBe(true)
    expect(r.notes[0]!.message).toBe('well is the string "false", which the legacy app treated as on')
    expect(feature(one('ContainerFeature', { rows: 1, columns: 1 }), 'x').inputs.well).toBe(false)
    expect(feature(one('ImageFeature', { responsive: '' }), 'x').inputs.responsive).toBe(false)
  })

  it('gives empty containers the defaults, with a note, and caps columns at 12', () => {
    const r = one('ContainerFeature', { rows: '', columns: 'x' })
    expect(feature(r, 'x').inputs).toMatchObject({ rows: 1, columns: 2 })
    expect(notes(r)).toEqual(['invalid-value:x'])
    expect(feature(one('ContainerFeature', { rows: '2', columns: '40' }), 'x').inputs).toMatchObject({ rows: 2, columns: 12 })
  })

  it('caps rows at the Container maximum, leaving features in later rows unplaced', () => {
    const r = run(
      legacyPage,
      { feature: 'ContainerFeature', id: 'c', inputs: { name: 'g', rows: '60', columns: '1', ...loc('#page_container') } },
      { feature: 'TextFeature', id: 'in', inputs: { text: '', ...loc('#container_g_c_row_50_col_1') } },
      { feature: 'TextFeature', id: 'out', inputs: { text: '', ...loc('#container_g_c_row_55_col_1') } },
    )
    expect(feature(r, 'c').inputs.rows).toBe(50)
    expect(feature(r, 'in').placement).toEqual({ parent: 'c', slot: 'r50c1' })
    expect(feature(r, 'out').placement).toBeUndefined()
    expect(notes(r)).toEqual(['invalid-value:c', 'unresolved-target:out'])
    expect(generate(r.model).diagnostics.map((d) => d.code)).toEqual(['missing-placement'])
  })

  it('maps Bootstrap values and absent styles on headers', () => {
    expect(feature(one('HeaderFeature', { text: 'Hi', size: '3', align: 'text-right', text_style: 'text-success', background: 'bg-info' }), 'x').inputs).toEqual({
      name: '',
      disable: false,
      text: 'Hi',
      size: 3,
      align: 'right',
      text_style: 'success',
      background: 'info',
    })
    const absent = one('HeaderFeature', { text: 'Hi' })
    expect(feature(absent, 'x').inputs).toMatchObject({ size: 1, align: 'left', text_style: '', background: '' })
    expect(notes(absent)).toEqual(['invalid-value:x'])
  })

  it('maps image and panel styles', () => {
    expect(feature(one('ImageFeature', { src: 's', align: 'pull-right', responsive: true }), 'x').inputs).toMatchObject({ align: 'right', responsive: true, width: '', height: '' })
    expect(feature(one('ImageFeature', { src: 's' }), 'x').inputs).toMatchObject({ align: 'left' })
    expect(feature(one('PanelFeature', { style: 'panel-warning', heading: 'H' }), 'x').inputs).toEqual({ name: '', disable: false, style: 'warning', heading: 'H' })
  })

  it('flags text that relied on HTML or AngularJS bindings', () => {
    expect(notes(one('TextFeature', { text: 'Temp {{DataResource.W.temp}}' }))).toEqual(['data-binding:x'])
    expect(notes(one('TextFeature', { text: 'a <b>bold</b> move' }))).toEqual(['markup-in-text:x'])
    expect(notes(one('TextFeature', { text: 'a < b' }))).toEqual([])
  })
})

describe('migrate: references and unported features', () => {
  const resource = (id: string, name: string): Legacy => ({ feature: 'DataResourceFeature', id, inputs: { name, resource: `https://api/${id}`, operation: 'GET' } })
  const table = (id: string, inputs: Record<string, unknown>): Legacy => ({ feature: 'TableFeature', id, inputs: { name: 'T', ...inputs, ...loc('#page_container') } })

  it('turns name-based data resource references into instance ids (first by name wins)', () => {
    const r = run(
      legacyPage,
      resource('21', 'Repos'),
      resource('22', 'Repos'),
      table('24', { resource: 'Repos', fields: 'name,description', labels: 'Name, Description', filters: 'uppercase,,date', data_resource: { name: 'Repos', operation: 'GET /repos' } }),
    )
    expect(feature(r, '24').inputs).toEqual({
      name: 'T',
      disable: false,
      data_resource: '21',
      operation: 'GET /repos',
      delete_operation: '',
      fields: ['name', 'description'],
      labels: ['Name', 'Description'],
      filters: ['uppercase', '', 'date'],
    })
  })

  it('normalizes operation methods and notes operations the resource does not provide', () => {
    const r = run(
      legacyPage,
      resource('21', 'Repos'),
      table('24', { data_resource: { name: 'Repos', operation: 'get /21', delete_operation: 'DELETE /21/{id}' } }),
    )
    expect(feature(r, '24').inputs).toMatchObject({ operation: 'GET /21', delete_operation: 'DELETE /21/{id}' })
    expect(r.notes.map((n) => `${n.code}:${n.featureInstanceId}: ${n.message}`)).toEqual([
      'unresolved-operation:24: Operation "DELETE /21/{id}" is not provided by data resource "Repos" (it provides "GET /21")',
    ])
  })

  it('notes references to resources that do not exist', () => {
    const r = run(legacyPage, table('24', { data_resource: { name: 'Gone' } }))
    expect(feature(r, '24').inputs.data_resource).toBe('')
    expect(r.notes[0]!.message).toBe('No data resource named "Gone"')
  })

  it('keeps unported features placed, with scalar inputs and the legacy instance in cache', () => {
    const legacyMap: Legacy = { feature: 'GoogleMapFeature', id: '16', inputs: { name: 'map', zoom: 12, data: { a: 1 }, ...loc('#page_container') } }
    const r = run(legacyPage, legacyMap)
    expect(feature(r, '16')).toEqual({
      feature: 'GoogleMapFeature',
      id: '16',
      inputs: { name: 'map', zoom: 12 },
      placement: { parent: '15', slot: 'content' },
      cache: { legacy: legacyMap },
    })
    expect(notes(r)).toEqual(['unported-feature:16'])
  })

  it('keeps a ported feature’s non-empty cache', () => {
    const r = run({ ...legacyPage, cache: { swagger: { models: {} } } }, { feature: 'TextFeature', id: '2', cache: {}, inputs: loc('#page_container') })
    expect(feature(r, '15').cache).toEqual({ swagger: { models: {} } })
    expect(feature(r, '2').cache).toBeUndefined()
  })
})

describe('legacy helpers', () => {
  it('derive DOM ids the way the legacy app did', () => {
    expect(legacyDomId('My  Container', '12')).toBe('my_container_12')
    expect(legacyDomId('', '5')).toBe('_5')
    expect(legacyDomId(undefined, '3')).toBe('undefined_3')
  })

  it('compute the grid a legacy container rendered', () => {
    expect(legacyGrid({ rows: '2', columns: '3' })).toEqual({ rows: 2, columns: 3 })
    expect(legacyGrid({ rows: 'x', columns: '40' })).toEqual({ rows: 0, columns: 12 })
  })

  it('map Bootstrap classes to plain values', () => {
    expect(['pull-left', 'text-center', 'center-block', 'pull-right'].map((v) => normalizeAlign(v, 'left'))).toEqual(['left', 'center', 'center', 'right'])
    expect(normalizeAlign('bogus', 'center')).toBe('center')
    expect(['text-info', 'bg-danger', 'panel-success', 'warning', '', 'text-bogus'].map(normalizeTone)).toEqual(['info', 'danger', 'success', 'warning', undefined, undefined])
  })
})

describe('migrate: upgrading v2 models when features get ported', () => {
  // What migrate() produced for a feature whose type was not ported yet: scalar inputs, legacy instance in cache.
  function asIfUnported(legacy: Legacy, migrated: FeatureInstance): FeatureInstance {
    const scalar = Object.fromEntries(Object.entries(legacy.inputs ?? {}).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))) as FeatureInstance['inputs']
    const unported: FeatureInstance = { feature: migrated.feature, id: migrated.id, inputs: scalar, cache: { legacy } }
    if (migrated.placement) unported.placement = migrated.placement
    return unported
  }

  it('re-migrates a feature from cache.legacy once its type is ported (e.g. List)', () => {
    const legacyList: Legacy = { feature: 'ListFeature', id: '7', inputs: { name: 'Color list', list: 'Red,Green,Blue,Yellow', align: 'center-block', ...loc('#page_container') } }
    const fresh = run(legacyPage, legacyList).model
    const stored = { ...fresh, features: [fresh.features[0]!, asIfUnported(legacyList, fresh.features[1]!)] }
    const upgraded = migrate(stored)
    expect(upgraded.model.features[1]).toEqual({
      feature: 'ListFeature',
      id: '7',
      inputs: { name: 'Color list', disable: false, items: ['Red', 'Green', 'Blue', 'Yellow'], align: 'center' },
      placement: { parent: '15', slot: 'content' },
    })
    expect(upgraded.notes).toEqual([
      { code: 'upgraded-feature', severity: 'info', featureInstanceId: '7', message: 'ListFeature is ported now; migrated from the legacy settings kept in cache.legacy' },
    ])
    expect(migrate(upgraded.model).model).toBe(upgraded.model)
  })

  it('drops legacy colours from Pages stored before pages were themed, with a note', () => {
    const stored: AppModel = {
      version: 2,
      name: 'Old',
      features: [
        { feature: 'PageFeature', id: '15', inputs: { name: 'Page', border_color: '#00a3ff', background_color: '', background_image: 'bg.png' }, placement: { parent: '$root', slot: 'content' } },
      ],
    }
    const upgraded = migrate(stored)
    expect(upgraded.model.features[0]!.inputs).toEqual({ name: 'Page', background_image: 'bg.png' })
    expect(upgraded.model.features[0]!.placement).toEqual({ parent: '$root', slot: 'content' })
    expect(upgraded.notes).toEqual([
      { code: 'dropped-style', severity: 'info', featureInstanceId: '15', message: 'Dropped legacy page border_color "#00a3ff"; pages are styled by their theme' },
    ])
    expect(stored.features[0]!.inputs).toHaveProperty('border_color')
    expect(migrate(upgraded.model).model).toBe(upgraded.model)
  })

  it('leaves features that are still not ported alone', () => {
    const legacyMap: Legacy = { feature: 'GoogleMapFeature', id: '16', inputs: { name: 'map', ...loc('#page_container') } }
    const stored = run(legacyPage, legacyMap).model
    expect(migrate(stored)).toEqual({ model: stored, notes: [] })
    expect(migrate(stored).model).toBe(stored)
  })

  it.each(['sample.json', 'app_models/buy_deal_sample.json', 'app_models/google_map_sample.json', 'app_models/swagger_resource_sample.json', 'app_models/watson_sample.json'])(
    'upgrading any feature migrated before it was ported gives the same model as migrating today (%s)',
    async (path) => {
      const { readFileSync } = await import('node:fs')
      const { join } = await import('node:path')
      const json: unknown = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', path), 'utf8'))
      const legacyFeatures = (Array.isArray(json) ? json : (json as { features: Legacy[] }).features) as Legacy[]
      const today = migrate(json).model
      const legacyById = new Map(legacyFeatures.map((f) => [String(f.id), f]))
      // Every feature that has an input migration today, pretended to have been unported when first migrated.
      const ported = today.features.filter((f) => !f.cache?.legacy)
      const stored = { ...today, features: today.features.map((f) => (f.cache?.legacy ? f : asIfUnported(legacyById.get(f.id)!, f))) }
      const upgraded = migrate(stored)
      expect(upgraded.model).toEqual(today)
      expect(upgraded.notes.filter((n) => n.code === 'upgraded-feature').map((n) => n.featureInstanceId)).toEqual(ported.map((f) => f.id))
    },
  )
})
