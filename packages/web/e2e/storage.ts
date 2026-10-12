import type { Page } from '@playwright/test'

const MODELS_KEY = 'feature-domain:models'

/** Puts a model into the app's browser storage (after the app has loaded once, so the samples are seeded first). */
export async function store(page: Page, model: { id: string; [key: string]: unknown }) {
  await page.evaluate(
    ({ m, key }) => {
      const stored = JSON.parse(localStorage.getItem(key) ?? '{"order":[],"models":{}}')
      stored.models[m.id] = m
      if (!stored.order.includes(m.id)) stored.order.push(m.id)
      localStorage.setItem(key, JSON.stringify(stored))
    },
    { m: model, key: MODELS_KEY },
  )
}

/**
 * The instance id of the feature named `name` in a stored model, so tests find a sample's features by name rather
 * than by ids that shift whenever a feature is added to the sample.
 */
export async function featureId(page: Page, modelId: string, name: string): Promise<string> {
  const id = await page.evaluate(
    ({ modelId, name, key }) => {
      const stored = JSON.parse(localStorage.getItem(key)!)
      const found = (stored.models[modelId]?.features ?? []).filter((f: { inputs: { name?: unknown } }) => f.inputs.name === name)
      return found.length === 1 ? (found[0].id as string) : undefined
    },
    { modelId, name, key: MODELS_KEY },
  )
  if (id === undefined) throw new Error(`No single feature named "${name}" in model ${modelId}`)
  return id
}

