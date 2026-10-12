import { generate, type AppModel } from '@feature-domain/engine'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import DocumentView from '../src/renderer/DocumentView.vue'
import { FETCH_JSON, type FetchJson } from '../src/renderer/rows'
import { inst, model, page } from './helpers'

const profile = inst('DataResourceFeature', 'r', { name: 'Profile', resource: 'https://api.example.com/users/tom', operation: 'GET' }, null)
const render = (m: AppModel, fetchJson: FetchJson, editing = false) =>
  mount(DocumentView, { props: { root: generate(m).root, editing }, global: { provide: { [FETCH_JSON as symbol]: fetchJson } } })
const text = (value: string) => inst('TextFeature', 't', { text: value, data_resource: 'r' })

describe('Text values from data', () => {
  it('fills in its values from the answer once it loads, through table filters, as plain text', async () => {
    const fetchJson = vi.fn<FetchJson>(async () => ({ public_repos: 35, followers: 1234, created_at: '2011-03-07T10:00:00Z', bio: '<b>hi</b>' }))
    const w = render(model(page(), profile, text('Tom has {{public_repos}} repos, {{followers | number}} followers, since {{created_at | date}}. {{bio}}')), fetchJson)
    const el = () => w.get('[data-feature-id="t"]')
    expect(el().text()).toBe('Tom has … repos, … followers, since …. …')
    expect(el().attributes('aria-busy')).toBe('true')
    await flushPromises()
    expect(fetchJson.mock.calls).toEqual([['https://api.example.com/users/tom']])
    expect(el().text()).toBe('Tom has 35 repos, 1,234 followers, since Mar 7, 2011. <b>hi</b>')
    expect(el().find('b').exists()).toBe(false)
    expect(el().attributes('aria-busy')).toBeUndefined()
  })

  it('shares one fetch with a table on the same resource', async () => {
    const fetchJson = vi.fn<FetchJson>(async () => [{ name: 'engine' }, { name: 'web' }])
    const w = render(model(page(), profile, text('{{length}} repos, first {{0.name}}'), inst('TableFeature', 'tb', { data_resource: 'r' })), fetchJson)
    await flushPromises()
    expect(fetchJson).toHaveBeenCalledTimes(1)
    expect(w.get('[data-feature-id="t"]').text()).toBe('2 repos, first engine')
  })

  it('shows a value that isn\'t there as "—" on the page, and as its marked binding on the editor canvas', async () => {
    const fetchJson: FetchJson = async () => ({ public_repos: 35 })
    const preview = render(model(page(), profile, text('{{public_repos}} and {{followrs}}')), fetchJson)
    const editor = render(model(page(), profile, text('{{public_repos}} and {{followrs}}')), fetchJson, true)
    await flushPromises()
    expect(preview.get('[data-feature-id="t"]').text()).toBe('35 and —')
    expect(editor.get('[data-feature-id="t"]').text()).toBe('35 and {{followrs}}')
    expect(editor.get('.fd-text-missing').attributes('title')).toBe('No value at “followrs”')
  })

  it('shows missing values when the answer fails to load', async () => {
    const w = render(model(page(), profile, text('Tom has {{public_repos}} repos')), async () => {
      throw new Error('403 Forbidden')
    })
    await flushPromises()
    expect(w.get('[data-feature-id="t"]').text()).toBe('Tom has — repos')
  })

  it('reads sample data as its rows, including rows a form added', async () => {
    const people = inst('DataResourceFeature', 'r', { name: 'People', source: 'sample', sample_rows: JSON.stringify([{ name: 'Ada' }, { name: 'Grace' }]) }, null)
    const fetchJson = vi.fn<FetchJson>()
    const w = render(model(page(), people, text('{{length}} people, first {{0.name}}')), fetchJson)
    await flushPromises()
    expect(fetchJson).not.toHaveBeenCalled()
    expect(w.get('[data-feature-id="t"]').text()).toBe('2 people, first Ada')
  })

  it('leaves a text without a resource exactly as written', async () => {
    const w = render(model(page(), inst('TextFeature', 't', { text: 'Temp {{x}} degrees' })), vi.fn<FetchJson>())
    expect(w.get('[data-feature-id="t"]').text()).toBe('Temp {{x}} degrees')
  })
})
