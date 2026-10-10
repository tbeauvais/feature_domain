import { migrate, type AppModel, type IllustrationId } from '@feature-domain/engine'

// The legacy sample models from the repository root, migrated to v2. Seeded into browser storage on first use.
const legacyModels = import.meta.glob<unknown>('../../../../app_models/*.json', { eager: true, import: 'default' })
const legacySample = import.meta.glob<unknown>('../../../../sample.json', { eager: true, import: 'default' })

/**
 * Bumped whenever `upgradeSample` changes, so browsers that seeded older samples get the change once
 * (`BrowserModelStore.upgradeSeeded`). 2: stock header photos became built-in banners. 3: those banners are short.
 * 4: the GitHub repo tables show languages as badges, names as they are, and scroll after 10 rows.
 */
export const SAMPLES_VERSION = 4

/** The samples' GitHub repo tables, exactly as migrated, and what they become. */
const LEGACY_REPO_TABLE = { fields: ['name', 'description', 'language', 'updated_at'], filters: ['uppercase', 'dataLink :data.html_url', '', 'date'] }
const REPO_TABLE_FILTERS = ['', 'dataLink :data.html_url', 'badge', 'date']
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The samples' header photos (stock images from other sites, mostly gone) and the banner that replaces each. */
const LEGACY_HEADERS: Readonly<Record<string, IllustrationId>> = {
  'http://www.baybridgecompanies.com/clipart/pageHeaders/blue_header.jpg': 'banner/blueprint',
  'https://www.nard.ma/images/english/web-application-header.jpg': 'banner/shapes',
  'http://www.dotpod.com.ar/wp-content/uploads/ibm-silvergate-argentina-02-710x242.jpg': 'banner/data-dots',
}

/**
 * A sample brought up to date. Returns the same object when nothing changes.
 * - Repo tables still exactly as migrated show languages as badges and names as they are, and scroll after 10 rows.
 * - Image features still showing one of the legacy header photos as a link show the matching banner instead, full
 *   width and short (the photos were 150px tall), described by its own alt text. The address stays, so switching
 *   Source back to Link restores it.
 */
export function upgradeSample(model: AppModel): AppModel {
  if (!Array.isArray(model.features)) return model
  let changed = false
  const features = model.features.map((f) => {
    if (typeof f?.inputs !== 'object' || f.inputs === null) return f
    if (f.feature === 'TableFeature') {
      if (!same(f.inputs.fields, LEGACY_REPO_TABLE.fields) || !same(f.inputs.filters, LEGACY_REPO_TABLE.filters)) return f
      changed = true
      return { ...f, inputs: { ...f.inputs, filters: REPO_TABLE_FILTERS, scroll_rows: f.inputs.scroll_rows ?? 10 } }
    }
    if (f.feature !== 'ImageFeature') return f
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
