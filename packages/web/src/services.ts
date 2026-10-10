import type { ModelStore } from '@feature-domain/engine'
import { sampleModels, SAMPLES_VERSION, upgradeSample } from './data/samples'
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

/** Startup for both pages: browser storage, seeded with the sample models on first use (or brought up to date). */
export async function initBrowserModelStore(): Promise<void> {
  const browser = new BrowserModelStore()
  // Bringing old samples up to date is a nicety: it must never stop the app from starting.
  await browser.upgradeSeeded(SAMPLES_VERSION, upgradeSample).catch((error: unknown) => console.warn('Could not upgrade the samples', error))
  await browser.seedOnce(sampleModels(), SAMPLES_VERSION)
  setModelStore(browser)
}
