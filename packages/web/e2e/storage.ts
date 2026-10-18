import { MemoryModelStore, type AppModel } from '@feature-domain/engine'
import type { BrowserContext, Page } from '@playwright/test'
import { SAMPLE_SET, sampleModels } from '../src/data/samples'
import { MODELS_PATH } from '../src/stores/apiModelStore'
import { workerApp, type WorkerApp } from '../test/workerApp'

// Each test's model API: the Worker's own routes, run in the test process over a store of the test's own, seeded with
// the samples as the database is. Tests run in parallel, so they can't share one database (each would see the others'
// edits); e2e/api.spec.ts and e2e/sync.spec.ts test the real Worker and D1.

let models: MemoryModelStore
/** The id the next stored model gets (MemoryModelStore makes up its own otherwise). */
let nextId: string | undefined

/** Answers the app's model API in this context from a fresh store holding the samples, under the seed's ids (`sample-2-1` …). */
export async function serveModels(context: BrowserContext): Promise<void> {
  let n = 0
  models = new MemoryModelStore(() => nextId ?? `model-${++n}`)
  for (const [i, sample] of sampleModels().entries()) await put(`sample-${SAMPLE_SET}-${i + 1}`, sample)
  const app: WorkerApp = await workerApp(models)
  await context.route(`**${MODELS_PATH}**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const response = await app.request(url.pathname + url.search, {
      method: request.method(),
      headers: request.headers(),
      body: request.postDataBuffer() as BodyInit | null,
    })
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) })
  })
}

async function put(id: string, model: unknown): Promise<void> {
  nextId = id
  try {
    await models.create(model as AppModel)
  } finally {
    nextId = undefined
  }
}

/** Stores a model under its own id. The store keeps whatever it is given, so tests can store invalid models too. */
export async function store(_page: Page, model: { id: string; [key: string]: unknown }): Promise<void> {
  await models.delete(model.id)
  await put(model.id, model)
}

/** The stored model with this id. */
export async function stored(id: string): Promise<AppModel> {
  const found = await models.get(id)
  if (!found) throw new Error(`No stored model ${id}`)
  return found.model
}

/** Changes a stored model as someone else would (a new revision), e.g. in another tab. */
export async function changeStored(id: string, change: (model: AppModel) => void): Promise<void> {
  const model = await stored(id)
  change(model)
  await models.update(id, model)
}

/** The id of the only stored model named `name`. */
export async function storedId(name: string): Promise<string> {
  const found = (await models.list()).filter((m) => m.name === name)
  if (found.length !== 1) throw new Error(`${found.length} stored models are named "${name}"`)
  return found[0]!.id
}

/**
 * The instance id of the feature named `name` in a stored model, so tests find a sample's features by name rather
 * than by ids that shift whenever a feature is added to the sample.
 */
export async function featureId(_page: Page, modelId: string, name: string): Promise<string> {
  const found = (await stored(modelId)).features.filter((f) => f.inputs.name === name)
  if (found.length !== 1) throw new Error(`No single feature named "${name}" in model ${modelId}`)
  return found[0]!.id
}
