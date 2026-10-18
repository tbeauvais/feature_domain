import { expect, test, type ConsoleMessage, type Page, type Route } from '@playwright/test'
import { serveModels } from './storage'

/** Resource types the app itself loads. Model content (images, data) may point anywhere; the app's own assets may not. */
const APP_ASSETS = new Set(['stylesheet', 'font', 'script'])

/** How Chrome reports a refusal by the Content Security Policy (e2e/api.spec.ts checks it still does). */
export const isCspViolation = (message: ConsoleMessage) => message.type() === 'error' && message.text().includes('Content Security Policy')

/**
 * Keeps every request on localhost: `handle` may fulfill some (e.g. mock the GitHub API); the rest are aborted. Aborting
 * alone would hide a regression (a CDN font just falls back), so an aborted stylesheet, font or script fails the test.
 * The model API is the test's own (`serveModels`), unless `realModels` sends it to the Worker and its D1 database. Any
 * Content Security Policy violation fails the test too.
 */
export function isolateNetwork(handle?: (route: Route, url: URL) => Promise<void> | undefined, { realModels = false } = {}) {
  let blockedAssets: string[] = []
  let violations: string[] = []
  test.beforeEach(async ({ page }: { page: Page }) => {
    blockedAssets = []
    violations = []
    // The pages' Content Security Policy (public/_headers) must never stop anything the app does. Chrome reports each
    // refusal as a console error, in every tab of the context.
    page.context().on('console', (message) => {
      if (isCspViolation(message)) violations.push(message.text())
    })
    await page.context().route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.hostname === 'localhost') return route.continue()
      const handled = handle?.(route, url)
      if (handled) return handled
      if (APP_ASSETS.has(route.request().resourceType())) blockedAssets.push(url.href)
      return route.abort()
    })
    // Registered last, so it is asked first.
    if (!realModels) await serveModels(page.context())
  })
  test.afterEach(() => {
    expect(blockedAssets, 'the app loaded assets from other sites').toEqual([])
    expect(violations, 'the Content Security Policy refused something').toEqual([])
  })
}
