// ESLint for the whole workspace: `npm run lint` (CI runs it). TypeScript's own checks are `npm run typecheck`; these
// rules catch what the compiler doesn't, chiefly promises nobody waits for (an autosave that silently fails) and HTML
// injected into generated pages.

import js from '@eslint/js'
import vue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.wrangler/**',
      'packages/web/test-results/**',
      'packages/web/playwright-report/**',
      // Vendored shadcn-vue components, added and updated by its CLI.
      'packages/web/src/components/ui/**',
      // The legacy app (CoffeeScript and AngularJS), kept as a reference.
      'app/**',
      'spec/**',
      'public/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Vue's correctness rules; its formatting rules are left out (layout is not what this lint is for).
  ...vue.configs['flat/essential'],
  {
    files: ['**/*.{ts,vue}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        parser: tseslint.parser,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      // A promise that is neither awaited nor marked `void` fails silently.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      // Generated pages show text as text, never as HTML.
      'vue/no-v-html': 'error',
      // A leading underscore marks a value left unused on purpose (e.g. a property taken out with a rest pattern).
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      // The app's own components (Inspector, Palette) can't be confused with HTML elements.
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
)
