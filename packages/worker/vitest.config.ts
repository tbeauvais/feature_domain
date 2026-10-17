import { defaultServerConditions } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Read the engine's TypeScript source, as packages/web does (its `@feature-domain/source` export condition).
  resolve: { conditions: ['@feature-domain/source', ...defaultServerConditions] },
  ssr: { resolve: { conditions: ['@feature-domain/source', ...defaultServerConditions] } },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Each file starts workerd and runs wrangler, which takes a few seconds.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
})
