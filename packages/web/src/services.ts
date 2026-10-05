import type { ModelStore } from '@feature-domain/engine'
import { sampleModels } from './data/samples'
import { BrowserModelStore } from './stores/browserModelStore'

let store: ModelStore | undefined

/** The model store the app uses. Tests replace it with `setModelStore`. */
export function modelStore(): ModelStore {
  if (!store) throw new Error('Model store not initialised; call initBrowserModelStore() at startup')
  return store
}

export function setModelStore(next: ModelStore): void {
  store = next
}

/** Startup for both pages: browser storage, seeded with the sample models on first use. */
export async function initBrowserModelStore(): Promise<void> {
  const browser = new BrowserModelStore()
  await browser.seedOnce(sampleModels())
  setModelStore(browser)
}
