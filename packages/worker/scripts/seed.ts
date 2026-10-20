// Seeds a D1 database with the samples and the home model, each once: `npm run db:seed` (local) or `npm run db:seed -- --remote` (Cloudflare).
// Any other arguments (e.g. --persist-to <dir>) go to `wrangler d1 execute`.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SAMPLE_MODELS } from '../../web/src/data/sampleModels'
import { SAMPLE_SET } from '../../web/src/data/samples'
import { homeModel } from '../src/home'
import { homeSeedSql, seedSql } from './seedSql'
import { localUnlessRemote, wrangler } from './wrangler'

const dir = mkdtempSync(join(tmpdir(), 'feature-domain-seed-'))
try {
  const file = join(dir, 'seed.sql')
  writeFileSync(file, seedSql(SAMPLE_MODELS, SAMPLE_SET) + homeSeedSql(homeModel()))
  wrangler(['d1', 'execute', 'DB', ...localUnlessRemote(process.argv.slice(2)), '--file', file], { stdio: 'inherit' })
} finally {
  rmSync(dir, { recursive: true, force: true })
}
