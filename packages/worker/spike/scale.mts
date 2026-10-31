// Spike: one local D1 database holding many apps' auth tables. Times creating them, reading one, changing the schema
// and exporting, as the number of apps grows.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, statSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getPlatformProxy } from 'wrangler'
import { D1AuthTables } from '../src/auth/store'
import { authTables } from '../src/auth/tables'

const APPS = Number(process.argv[2] ?? 2000)
const dir = mkdtempSync(join(tmpdir(), 'auth-scale-'))
const wrangler = (...args: string[]) =>
  execFileSync('node_modules/.bin/wrangler', [...args, '--local', '--persist-to', dir, '-c', 'spike/wrangler.jsonc'], {
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
    stdio: 'pipe',
  })
wrangler('d1', 'migrations', 'apply', 'DB')
const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: 'spike/wrangler.jsonc', persist: { path: join(dir, 'v3') } })
const db = proxy.env.DB

const ms = async (f: () => Promise<unknown>, n = 1) => {
  const s = performance.now()
  for (let i = 0; i < n; i++) await f()
  return (performance.now() - s) / n
}
const keys: string[] = []
const checkpoints = new Set([1, 1000, 2000, 3000, 4000, 5000, APPS])
let batchStart = performance.now()
for (let i = 1; i <= APPS; i++) {
  keys.push((await new D1AuthTables(db).ensure(`model-${i}`)).key)
  if (checkpoints.has(i)) {
    const createAvg = (performance.now() - batchStart) / (i === 1 ? 1 : i - ([...checkpoints].filter((c) => c < i).at(-1) ?? 0))
    const pick = authTables(keys[Math.floor(Math.random() * keys.length)]!)
    const read = await ms(() => db.prepare(`SELECT * FROM "${pick.user}" WHERE email = ?`).bind('ann@example.com').all(), 50)
    const write = await ms(
      () =>
        db
          .prepare(`INSERT INTO "${pick.rateLimit}" (id, key, count, lastRequest) VALUES (?, ?, 1, 0) ON CONFLICT(key) DO UPDATE SET count = count + 1`)
          .bind(crypto.randomUUID(), 'k')
          .run(),
      20,
    )
    const modelsRead = await ms(() => db.prepare('SELECT id FROM models LIMIT 1').all(), 50)
    const files = readdirSync(join(dir, 'v3', 'd1', 'miniflare-D1DatabaseObject')).filter((f) => f.endsWith('.sqlite'))
    const size = files.reduce((s, f) => s + statSync(join(dir, 'v3', 'd1', 'miniflare-D1DatabaseObject', f)).size, 0)
    console.log(
      `${String(i).padStart(5)} apps (${i * 5} tables): create ${createAvg.toFixed(1)} ms/app, auth read ${read.toFixed(2)} ms, rate-limit write ${write.toFixed(2)} ms, models read ${modelsRead.toFixed(2)} ms, file ${(size / 1e6).toFixed(1)} MB`,
    )
    batchStart = performance.now()
  }
}
const alter = await ms(() => db.prepare(`ALTER TABLE "${authTables(keys[0]!).user}" ADD COLUMN probe text`).run())
const afterAlter = await ms(() => db.prepare('SELECT id FROM models LIMIT 1').all())
const masterRead = await ms(() => db.prepare("SELECT count(*) FROM sqlite_master WHERE type = 'table'").all())
const migrate = await ms(() => db.prepare('ALTER TABLE models ADD COLUMN probe2 text').run())
await proxy.dispose()
const file = join(
  dir,
  'v3',
  'd1',
  'miniflare-D1DatabaseObject',
  readdirSync(join(dir, 'v3', 'd1', 'miniflare-D1DatabaseObject')).find((f) => f.endsWith('.sqlite'))!,
)
const s = performance.now()
execFileSync('sh', ['-c', `sqlite3 "${file}" .dump > "${join(dir, 'export.sql')}"`])
const exportMs = performance.now() - s
console.log(
  `one ALTER on an app table ${alter.toFixed(1)} ms; next models read ${afterAlter.toFixed(1)} ms; count sqlite_master ${masterRead.toFixed(1)} ms; ALTER on models ${migrate.toFixed(1)} ms; sqlite3 dump ${(exportMs / 1000).toFixed(1)} s (${(statSync(join(dir, 'export.sql')).size / 1e6).toFixed(1)} MB)`,
)
console.log(dir)
