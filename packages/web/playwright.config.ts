import { defineConfig, devices } from '@playwright/test'

// End-to-end tests run against a production build served by `vite preview`.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  // Screenshots: a pixel counts as changed when its color differs by more than 1% (Playwright's default, 20%, let a
  // swap between two pale tints pass unnoticed). Runs in one Docker image, so text rendering doesn't vary.
  expect: { toHaveScreenshot: { threshold: 0.01 } },
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    // Always build and serve fresh, so a stale preview server on the port is never tested by mistake.
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
