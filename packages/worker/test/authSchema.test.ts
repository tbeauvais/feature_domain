// The auth tables' DDL template (src/auth/tables.ts) must be what Better Auth expects: create it in SQLite, then ask
// Better Auth's own migration planner what is missing. An upgrade of Better Auth that adds a table or column fails here,
// and gets a new schema step, before it reaches any app.

import { DatabaseSync } from 'node:sqlite'
import { getMigrations } from 'better-auth/db/migration'
import { describe, expect, it } from 'vitest'
import { authConfig } from '../src/auth/authFor'
import { MemoryMailer } from '../src/auth/mailer'
import { AUTH_SCHEMA_STEPS, authTables } from '../src/auth/tables'

const KEY = '0123456789abcdef0123456789abcdef'

/** What Better Auth would still create or add, given tables made by these statements. */
async function missing(statements: string[]) {
  const sqlite = new DatabaseSync(':memory:')
  for (const sql of statements) sqlite.exec(sql)
  const config = authConfig({
    db: sqlite as unknown as D1Database,
    key: KEY,
    secret: '9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0',
    baseURL: 'https://meetup.apprun.app',
    appName: 'Shoreline meetup',
    mailer: new MemoryMailer(),
    waitUntil: () => {},
  })
  const { toBeCreated, toBeAdded } = await getMigrations(config)
  return [...toBeCreated.map((t) => t.table), ...toBeAdded.map((t) => `${t.table}: ${Object.keys(t.fields).join(', ')}`)]
}

const template = () => AUTH_SCHEMA_STEPS.flatMap((step) => step(authTables(KEY)))

describe('auth schema', () => {
  it("matches what Better Auth expects for an app's tables", async () => {
    expect(await missing(template())).toEqual([])
  })

  it('notices a column the template lacks', async () => {
    const lacking = template().map((sql) => sql.replace(', "ipAddress" text', ''))
    expect(await missing(lacking)).toEqual([`${authTables(KEY).session}: ipAddress`])
  })
})
