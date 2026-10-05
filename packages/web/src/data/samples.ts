import { migrate, type AppModel } from '@feature-domain/engine'

// The legacy sample models from the repository root, migrated to v2. Seeded into browser storage on first use.
const legacyModels = import.meta.glob<unknown>('../../../../app_models/*.json', { eager: true, import: 'default' })
const legacySample = import.meta.glob<unknown>('../../../../sample.json', { eager: true, import: 'default' })

export function sampleModels(): AppModel[] {
  const fromSample = Object.values(legacySample).map((legacy) => ({ ...migrate(legacy).model, name: 'Getting Started' }))
  const fromModels = Object.keys(legacyModels)
    .sort()
    .map((path) => migrate(legacyModels[path]).model)
  return [...fromSample, ...fromModels]
}
