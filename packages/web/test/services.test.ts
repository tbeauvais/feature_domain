import type { AppModel } from '@feature-domain/engine'
import { afterEach, describe, expect, it } from 'vitest'
import { SAMPLES_VERSION, sampleModels } from '../src/data/samples'
import { initBrowserModelStore, modelStore } from '../src/services'
import { MODELS_KEY } from '../src/stores/browserModelStore'
import { inst, model, page } from './helpers'

describe('initBrowserModelStore', () => {
  afterEach(() => window.localStorage.clear())
  const names = async () => (await modelStore().list()).map((m) => m.name)

  it('seeds a fresh browser with the samples', async () => {
    await initBrowserModelStore()
    expect(await names()).toEqual(sampleModels().map((m) => m.name))
  })

  it('upgrades a browser seeded with the legacy samples, then adds the new ones at the top, once', async () => {
    // Seeded at version 11 with set 1: an old model listing a text before the page it is on.
    const old: AppModel = { ...model(inst('TextFeature', 't', { text: 'Hi' }), page()), name: 'Old', id: 'old' }
    window.localStorage.setItem(MODELS_KEY, JSON.stringify({ order: ['old'], models: { old } }))
    window.localStorage.setItem('feature-domain:seeded', '2025-01-01T00:00:00.000Z')
    window.localStorage.setItem('feature-domain:samples-version', '11')
    await initBrowserModelStore()
    const expected = [...sampleModels().map((m) => m.name), 'Old']
    expect(await names()).toEqual(expected)
    expect((await modelStore().get('old'))!.features.map((f) => f.id)).toEqual(['1', 't'])
    expect(window.localStorage.getItem('feature-domain:samples-version')).toBe(String(SAMPLES_VERSION))
    await initBrowserModelStore()
    expect(await names()).toEqual(expected)
  })
})
