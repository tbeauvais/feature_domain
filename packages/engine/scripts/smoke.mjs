// Imports the built package by name, as plain Node (and later the Worker) would, and runs it on a sample model.
import { readFileSync } from 'node:fs'
import { generate, migrate } from '@feature-domain/engine'

const legacy = JSON.parse(readFileSync(new URL('../../../app_models/google_map_sample.json', import.meta.url), 'utf8'))
const { root, diagnostics } = generate(migrate(legacy).model)
const errors = diagnostics.filter((d) => d.severity === 'error')
if (root.children.length === 0 || errors.length > 0) {
  console.error('smoke test failed', { children: root.children.length, errors })
  process.exit(1)
}
console.log(`smoke test passed: ${root.children.length} page(s), ${diagnostics.length} diagnostic(s)`)
