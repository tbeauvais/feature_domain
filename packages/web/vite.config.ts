import { fileURLToPath, URL } from 'node:url'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defaultClientConditions } from 'vite'
import { defineConfig } from 'vitest/config'

const worker = (path: string) => fileURLToPath(new URL(`../worker/${path}`, import.meta.url))

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    // The Worker (packages/worker): `vite dev` and `vite preview` run it in workerd with its local D1, as Cloudflare
    // runs it, and `vite build` emits it beside the app. Its data is the worker package's, so wrangler commands run
    // there (`npm run db:reset -w packages/worker`) see the same database; FD_STATE_DIR points elsewhere (e2e tests).
    // Unit tests render components in jsdom and need no Worker.
    !process.env.VITEST &&
      cloudflare({
        configPath: worker('wrangler.jsonc'),
        persistState: { path: process.env.FD_STATE_DIR ?? worker('.wrangler/state') },
      }),
  ],
  resolve: {
    // Read the engine's TypeScript source (its `@feature-domain/source` export condition) instead of a built dist/.
    // The condition name is ours alone: a generic "source" would also pick up other packages' raw sources.
    // Setting conditions replaces Vite's defaults, so keep them.
    conditions: ['@feature-domain/source', ...defaultClientConditions],
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  environments: {
    // The Worker's environment (named after it in wrangler.jsonc) reads the engine's source too. The plugin sets its
    // own conditions there, which Vite merges with these.
    app: { resolve: { conditions: ['@feature-domain/source'] } },
    client: {
      build: {
        // Two pages: the editor (index.html, with Tailwind) and the standalone preview (preview.html, without it), so
        // generated pages look the same in the preview as on a published site. (The Worker is built separately.)
        rollupOptions: {
          input: {
            main: fileURLToPath(new URL('./index.html', import.meta.url)),
            preview: fileURLToPath(new URL('./preview.html', import.meta.url)),
          },
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
  },
})
