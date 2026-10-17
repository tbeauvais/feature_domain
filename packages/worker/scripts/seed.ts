// Seeds a D1 database with the samples, once: `npm run db:seed` (local) or `npm run db:seed -- --remote` (Cloudflare).
// Any other arguments (e.g. --persist-to <dir>) go to `wrangler d1 execute`.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SAMPLE_MODELS } from '../../web/src/data/sampleModels'
import { SAMPLE_SET } from '../../web/src/data/samples'
import { seedSql } from './seedSql'

const args = process.argv.slice(2)
const target = args.includes('--remote') ? [] : ['--local']
const dir = mkdtempSync(join(tmpdir(), 'feature-domain-seed-'))
try {
  const file = join(dir, 'seed.sql')
  writeFileSync(file, seedSql(SAMPLE_MODELS, SAMPLE_SET))
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', ...target, ...args, '--file', file], {
    cwd: join(import.meta.dirname, '..'),
    stdio: 'inherit',
  })
} finally {
  rmSync(dir, { recursive: true, force: true })
}
