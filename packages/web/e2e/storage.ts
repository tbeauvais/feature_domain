import { MemoryModelStore, MemoryRowStore, type AppModel } from '@feature-domain/engine'
import type { BrowserContext, Page, Route } from '@playwright/test'
import { SAMPLE_SET, sampleModels } from '../src/data/samples'
import { HOME_RESET_PATH } from '../src/stores/apiModelStore'
import { workerApp, type WorkerApp } from '../test/workerApp'

// Each test's model API: the Worker's own routes, run in the test process over a store of the test's own, seeded with
// the samples as the database is. Tests run in parallel, so they can't share one database (each would see the others'
// edits); e2e/api.spec.ts and e2e/sync.spec.ts test the real Worker and D1.

let models: MemoryModelStore
let app: WorkerApp | undefined
/** Answers what the Worker's proxy fetches from other sites; nothing is reachable unless a test says so (`answerProxy`). */
let upstream: (url: string, init: RequestInit) => Response | Promise<Response>
/** The id the next stored model gets (MemoryModelStore makes up its own otherwise). */
let nextId: string | undefined

/** When every model in the tests' stores was last saved, so the home page's dates never change a screenshot. */
export const SAVED_AT = Date.UTC(2026, 9, 20, 9, 0)

/**
 * Answers the app's API in this context from a fresh store holding the samples, under the seed's ids (`sample-2-1` …),
 * and the built-in home page, as the seeded database does.
 */
export async function serveModels(context: BrowserContext): Promise<void> {
  let n = 0
  models = new MemoryModelStore(
    () => nextId ?? `model-${++n}`,
    () => SAVED_AT,
  )
  for (const [i, sample] of sampleModels().entries()) await put(`sample-${SAMPLE_SET}-${i + 1}`, sample)
  upstream = () => Promise.reject(new TypeError('fetch failed'))
  // Database tables' rows, stamped at the same time, so their dates don't change a screenshot either.
  const rows = new MemoryRowStore(() => SAVED_AT)
  const worker = await workerApp(models, async (input, init = {}) => upstream(String(input), init), rows)
  app = worker
  await worker.request(HOME_RESET_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  const serve = async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    // The whole address, so the Worker picks the site by host: the builder, or a published app at <slug>.localhost.
    const response = await worker.request(url.href, {
      method: request.method(),
      headers: request.headers(),
      body: request.postDataBuffer() as BodyInit | null,
    })
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) })
  }
  await context.route('**/api/v1/**', serve)
}

/** How the sites the Worker's proxy fetches from answer (the proxy itself is the Worker's real route). */
export function answerProxy(answer: typeof upstream): void {
  upstream = answer
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

/** Deletes a stored model, as someone else would. */
export async function removeStored(id: string): Promise<void> {
  await models.delete(id)
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

/** Publishes a stored model's current revision as the editor's Publish dialog would; returns the Worker's answer. */
export async function publishStored(
  id: string,
  body: { slug?: string; copyDraftRows?: boolean; removeTables?: string[] },
): Promise<{ url: string; version: number }> {
  if (!app) throw new Error("publishStored needs the test's own model API (isolateNetwork without realModels)")
  const found = await models.get(id)
  if (!found) throw new Error(`No stored model ${id}`)
  const response = await app.request(`http://localhost/api/v1/models/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'If-Match': `"${found.revision}"` },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Publishing ${id} failed: ${response.status} ${await response.text()}`)
  return (await response.json()) as { url: string; version: number }
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
