import { migrate, type AppModel, type IllustrationId } from '@feature-domain/engine'

// The legacy sample models from the repository root, migrated to v2. Seeded into browser storage on first use.
const legacyModels = import.meta.glob<unknown>('../../../../app_models/*.json', { eager: true, import: 'default' })
const legacySample = import.meta.glob<unknown>('../../../../sample.json', { eager: true, import: 'default' })

/**
 * Bumped whenever `upgradeSample` changes, so browsers that seeded older samples get the change once
 * (`BrowserModelStore.upgradeSeeded`). 2: stock header photos became built-in banners. 3: those banners are short.
 */
export const SAMPLES_VERSION = 3

/** The samples' header photos (stock images from other sites, mostly gone) and the banner that replaces each. */
const LEGACY_HEADERS: Readonly<Record<string, IllustrationId>> = {
  'http://www.baybridgecompanies.com/clipart/pageHeaders/blue_header.jpg': 'banner/blueprint',
  'https://www.nard.ma/images/english/web-application-header.jpg': 'banner/shapes',
  'http://www.dotpod.com.ar/wp-content/uploads/ibm-silvergate-argentina-02-710x242.jpg': 'banner/data-dots',
}

/**
 * A sample brought up to date: Image features still showing one of the legacy header photos as a link show the
 * matching banner instead, full width and short (the photos were 150px tall), described by its own alt text. The address stays, so switching Source back to
 * Link restores it. Returns the same object when nothing changes.
 */
export function upgradeSample(model: AppModel): AppModel {
  if (!Array.isArray(model.features)) return model
  let changed = false
  const features = model.features.map((f) => {
    if (f?.feature !== 'ImageFeature' || typeof f.inputs !== 'object' || f.inputs === null) return f
    const src = f.inputs.src
    const banner = typeof src === 'string' && Object.hasOwn(LEGACY_HEADERS, src) ? LEGACY_HEADERS[src] : undefined
    if (banner === undefined) return f
    if (f.inputs.source !== 'illustration') {
      changed = true
      return { ...f, inputs: { ...f.inputs, source: 'illustration', illustration: banner, banner_height: 'short', responsive: true, alt: '' } }
    }
    // Upgraded to a banner before heights existed (version 2): make it short, keeping the illustration chosen.
    if (f.inputs.banner_height === undefined && typeof f.inputs.illustration === 'string' && f.inputs.illustration.startsWith('banner/')) {
      changed = true
      return { ...f, inputs: { ...f.inputs, banner_height: 'short' } }
    }
    return f
  })
  return changed ? { ...model, features } : model
}

export function sampleModels(): AppModel[] {
  const fromSample = Object.values(legacySample).map((legacy) => ({ ...migrate(legacy).model, name: 'Getting Started' }))
  const fromModels = Object.keys(legacyModels)
    .sort()
    .map((path) => migrate(legacyModels[path]).model)
  return [...fromSample, ...fromModels].map(upgradeSample)
}
