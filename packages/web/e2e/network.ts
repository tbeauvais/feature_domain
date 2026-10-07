import { expect, test, type Page, type Route } from '@playwright/test'

/** Resource types the app itself loads. Model content (images, data) may point anywhere; the app's own assets may not. */
const APP_ASSETS = new Set(['stylesheet', 'font', 'script'])

/**
 * Keeps every request on localhost: `handle` may fulfil some (e.g. mock the GitHub API); the rest are aborted. Aborting
 * alone would hide a regression (a CDN font just falls back), so an aborted stylesheet, font or script fails the test.
 */
export function isolateNetwork(handle?: (route: Route, url: URL) => Promise<void> | undefined) {
  let blockedAssets: string[] = []
  test.beforeEach(async ({ page }: { page: Page }) => {
    blockedAssets = []
    await page.context().route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.hostname === 'localhost') return route.continue()
      const handled = handle?.(route, url)
      if (handled) return handled
      if (APP_ASSETS.has(route.request().resourceType())) blockedAssets.push(url.href)
      return route.abort()
    })
  })
  test.afterEach(() => {
    expect(blockedAssets, 'the app loaded assets from other sites').toEqual([])
  })
}
