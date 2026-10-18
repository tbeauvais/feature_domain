import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { unstable_readConfig } from 'wrangler'
import { expect, it } from 'vitest'
import { WORKER_DIR } from '../scripts/wrangler'

const config = unstable_readConfig({ config: join(WORKER_DIR, 'wrangler.jsonc') })
const terraform = readFileSync(join(WORKER_DIR, '../../infrastructure/main.tf'), 'utf8')

it('is deployed where Terraform puts Access in front of it', () => {
  // The hostname Access protects is <worker name>.<the account's workers.dev subdomain>; renaming the Worker without
  // changing it would leave the new address open.
  const hostname = /variable "hostname" \{[^}]*default\s*=\s*"([^"]+)"/.exec(terraform)?.[1]
  expect(hostname).toBe(`${config.name}.feature-domain.workers.dev`)
  expect(config.workers_dev).toBe(true)
  // Preview URLs are hostnames of their own, which the Access application doesn't cover.
  expect(config.preview_urls).toBe(false)
})
