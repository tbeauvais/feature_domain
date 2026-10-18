import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { unstable_readConfig } from 'wrangler'
import { expect, it } from 'vitest'
import { WORKER_DIR } from '../scripts/wrangler'

const config = unstable_readConfig({ config: join(WORKER_DIR, 'wrangler.jsonc') })
const terraform = readFileSync(join(WORKER_DIR, '../../infrastructure/main.tf'), 'utf8')
const viteConfig = readFileSync(join(WORKER_DIR, '../web/vite.config.ts'), 'utf8')

it('is deployed where Terraform puts Access in front of it', () => {
  // The hostname Access protects is <worker name>.<the account's workers.dev subdomain>; renaming the Worker without
  // changing it would leave the new address open.
  const hostname = /variable "hostname" \{[^}]*default\s*=\s*"([^"]+)"/.exec(terraform)?.[1]
  expect(hostname).toBe(`${config.name}.feature-domain.workers.dev`)
  expect(config.workers_dev).toBe(true)
  // Preview URLs are hostnames of their own, which the Access application doesn't cover.
  expect(config.preview_urls).toBe(false)
})

it('is built from the engine source', () => {
  // The Vite environment is named after the Worker. Configured under another name, the Worker would read the engine's
  // built dist/ instead, and a stale one would deploy an old engine.
  // Whitespace aside, so the formatter may lay the config out as it likes.
  const flat = viteConfig.replace(/\s+/g, ' ')
  expect(flat).toContain(` ${config.name}: { resolve: { conditions: ['@feature-domain/source'] } },`)
})
