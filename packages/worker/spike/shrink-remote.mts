// Spike: drops apps from the remote scale database down to each size, and times one ALTER there (D1's own times).
import { getPlatformProxy } from 'wrangler'
import { authTables, tablesOf } from '../src/auth/tables'

const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: 'spike/wrangler.remote.jsonc' })
const db = proxy.env.DB
const dur = (r: D1Result) => r.meta.duration ?? 0
for (const target of [2000, 1000, 500, 100]) {
  const rows = (await db.prepare('SELECT model_id, key FROM app_auth ORDER BY rowid DESC').all<{ model_id: string; key: string }>()).results
  const t0 = performance.now()
  let dropDb = 0
  const extra = rows.slice(0, Math.max(0, rows.length - target))
  for (let i = 0; i < extra.length; i += 1) {
    const group = extra.slice(i, i + 1)
    await db.batch(
      group.flatMap((a) => [
        ...tablesOf(authTables(a.key)).map((t) => db.prepare(`DROP TABLE "${t}"`)),
        db.prepare('DELETE FROM app_auth WHERE model_id = ?').bind(a.model_id),
      ]),
    )
  }
  const left = (await db.prepare('SELECT count(*) AS n FROM app_auth').first<{ n: number }>())!.n
  const key = (await db.prepare('SELECT key FROM app_auth LIMIT 1').first<{ key: string }>())!.key
  const alterApp = dur(await db.prepare(`ALTER TABLE "${authTables(key).user}" ADD COLUMN probe_${Date.now()} text`).run())
  const alterModels = dur(await db.prepare(`ALTER TABLE models ADD COLUMN probe_${Date.now()} text`).run())
  const create = dur((await db.batch([db.prepare(`CREATE TABLE probe_${Date.now()} (id text primary key)`)]))[0]!)
  console.log(
    `${left} apps (${left * 5} tables): ALTER app table ${alterApp.toFixed(0)} ms, ALTER models ${alterModels.toFixed(0)} ms, CREATE TABLE ${create.toFixed(0)} ms (in D1)`,
  )
}
await proxy.dispose()
