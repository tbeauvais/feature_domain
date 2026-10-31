// Brings every published app's sign-in tables up to date, drops those of deleted models, and sweeps orphan tables:
// `npm run db:upgrade-apps` (local D1) or `npm run db:upgrade-apps -- --remote` (Cloudflare's). Run it after a deploy
// that adds a schema step (src/auth/tables.ts); apps not upgraded yet still work, as steps only add. One app at a time.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getPlatformProxy, unstable_readConfig } from 'wrangler'
import { D1AuthTables } from '../src/auth/store'
import type { Env } from '../src/env'
import { WORKER_DIR } from './wrangler'

const remote = process.argv.includes('--remote')
const configPath = join(WORKER_DIR, 'wrangler.jsonc')

/** For --remote: the Worker's D1 binding only, marked remote, so the proxy reaches Cloudflare's database. */
function remoteConfig(): { path: string; dispose: () => void } {
  const config = unstable_readConfig({ config: configPath })
  const db = config.d1_databases.find((d: { binding: string }) => d.binding === 'DB')
  if (!db) throw new Error('wrangler.jsonc has no DB binding')
  const dir = mkdtempSync(join(tmpdir(), 'upgrade-apps-'))
  const path = join(dir, 'wrangler.json')
  const binding = { binding: 'DB', database_name: db.database_name, database_id: db.database_id, remote: true }
  writeFileSync(path, JSON.stringify({ name: config.name, compatibility_date: config.compatibility_date, d1_databases: [binding] }))
  return { path, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}

const temporary = remote ? remoteConfig() : undefined
const proxy = await getPlatformProxy<Env>({ configPath: temporary?.path ?? configPath, remoteBindings: remote })
try {
  const report = await new D1AuthTables(proxy.env.DB).upgradeAll()
  console.log(`Upgraded ${report.upgraded.length} app(s), dropped ${report.dropped.length} of deleted models, swept ${report.orphans.length} orphan(s).`)
} finally {
  await proxy.dispose()
  temporary?.dispose()
}
