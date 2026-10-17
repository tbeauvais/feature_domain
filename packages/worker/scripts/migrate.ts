// Applies migrations/ to D1: `npm run db:migrate` (local) or `npm run db:migrate -- --remote` (Cloudflare).
// Any other arguments (e.g. --persist-to <dir>) go to `wrangler d1 migrations apply`.

import { localUnlessRemote, wrangler } from './wrangler'

wrangler(['d1', 'migrations', 'apply', 'DB', ...localUnlessRemote(process.argv.slice(2))], { stdio: 'inherit' })
