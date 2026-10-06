import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defaultClientConditions } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    // Read the engine's TypeScript source (its `@feature-domain/source` export condition) instead of a built dist/.
    // The condition name is ours alone: a generic "source" would also pick up other packages' raw sources.
    // Setting conditions replaces Vite's defaults, so keep them.
    conditions: ['@feature-domain/source', ...defaultClientConditions],
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    // Two pages: the editor (index.html, with Tailwind) and the standalone preview (preview.html, without it), so
    // generated pages look the same in the preview as on a published site.
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        preview: fileURLToPath(new URL('./preview.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
  },
})
