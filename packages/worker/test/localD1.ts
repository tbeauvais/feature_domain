// A fresh local D1 database for a test file, set up the way `wrangler dev` and deploys set up theirs: wrangler applies
// migrations/ to it, and the store under test reaches it through workerd (getPlatformProxy), as the Worker does.
// (wrangler's --persist-to names the folder holding `v3`; getPlatformProxy wants the `v3` folder itself.)

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getPlatformProxy } from 'wrangler'
import { WORKER_DIR, wrangler as run } from '../scripts/wrangler'
import type { Env } from '../src/env'

/** Runs wrangler from the worker package against a local database stored in `persistTo`. */
export function wrangler(persistTo: string, ...args: string[]): string {
  return run([...args, '--local', '--persist-to', persistTo], {
    encoding: 'utf8',
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  }) as string
}

export interface LocalD1 {
  env: Env
  dir: string
  dispose(): Promise<void>
}

/** A fresh local database, migrated unless `migrate` is false (to test the migrations themselves). */
export async function localD1({ migrate = true } = {}): Promise<LocalD1> {
  const dir = mkdtempSync(join(tmpdir(), 'feature-domain-d1-'))
  if (migrate) wrangler(dir, 'd1', 'migrations', 'apply', 'DB')
  const proxy = await getPlatformProxy<Env>({ configPath: join(WORKER_DIR, 'wrangler.jsonc'), persist: { path: join(dir, 'v3') }, remoteBindings: false })
  return {
    env: proxy.env,
    dir,
    async dispose() {
      await proxy.dispose()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
