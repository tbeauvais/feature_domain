// Spike: the scale test on Cloudflare's D1. Times come from D1's own `meta.duration` (time spent in the database),
// so the network between here and Cloudflare doesn't count; wall times are shown beside them.
import { getPlatformProxy } from 'wrangler'
import { AUTH_SCHEMA_STEPS, authTables, newAuthKey } from '../src/auth/tables'

const APPS = Number(process.argv[2] ?? 3000)
const START = Number(process.argv[3] ?? 1)
const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: 'spike/wrangler.remote.jsonc' })
const db = proxy.env.DB
const dur = (results: D1Result[] | D1Result) => (Array.isArray(results) ? results : [results]).reduce((s, r) => s + (r.meta.duration ?? 0), 0)
const checkpoints = new Set([1, 250, 500, 1000, 1500, 2000, 2500, 3000, APPS])
const keys: string[] = []
let createDb = 0
let createWall = 0
let since = START - 1
for (let i = START; i <= APPS; i++) {
  const key = newAuthKey()
  keys.push(key)
  const statements = [
    ...AUTH_SCHEMA_STEPS.flatMap((step) => step(authTables(key))).map((sql) => db.prepare(sql)),
    db.prepare('INSERT INTO app_auth (model_id, key, schema_version) VALUES (?, ?, 1)').bind(`model-${i}`, key),
  ]
  const t = performance.now()
  const results = await db.batch(statements)
  createWall += performance.now() - t
  createDb += dur(results)
  if (checkpoints.has(i)) {
    const n = i - since
    const pick = authTables(keys[Math.floor(Math.random() * keys.length)]!)
    let readDb = 0
    const t2 = performance.now()
    for (let k = 0; k < 10; k++) readDb += dur(await db.prepare(`SELECT * FROM "${pick.user}" WHERE email = ?`).bind('ann@example.com').all())
    const readWall = (performance.now() - t2) / 10
    const size = results.at(-1)!.meta.size_after
    console.log(
      `${String(i).padStart(5)} apps (${i * 5} tables): create ${(createDb / n).toFixed(1)} ms/app in D1 (${(createWall / n).toFixed(0)} wall); auth read ${(readDb / 10).toFixed(2)} ms in D1 (${readWall.toFixed(0)} wall); size ${(size / 1e6).toFixed(1)} MB`,
    )
    createDb = createWall = 0
    since = i
  }
}
const alterApp = dur(await db.prepare(`ALTER TABLE "${authTables(keys[0]!).user}" ADD COLUMN probe_${Date.now()} text`).run())
const alterModels = dur(await db.prepare(`ALTER TABLE models ADD COLUMN probe_${Date.now()} text`).run())
const master = dur(await db.prepare("SELECT count(*) FROM sqlite_master WHERE type = 'table'").all())
console.log(`ALTER on an app table ${alterApp.toFixed(1)} ms in D1; ALTER on models ${alterModels.toFixed(1)} ms; count sqlite_master ${master.toFixed(1)} ms`)
await proxy.dispose()
