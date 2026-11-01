// A Database table's access rules on a published app (src/rows.ts, src/appHost.ts), through the Worker's routes on the
// real local D1 with real sign-in: who may see, add, change and delete rows, what a deleted account leaves, and what a
// person downloads. The builder's draft rows never apply them.

import { SIGN_IN_FEATURE, type AppModel, type InputValue } from '@feature-domain/engine'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { MemoryMailer } from '../src/auth/mailer'
import { D1AuthTables } from '../src/auth/store'
import { D1AppStore } from '../src/d1AppStore'
import type { Env } from '../src/env'
import { localD1, type LocalD1 } from './localD1'

const BUILDER = 'http://localhost'
const SECRET = 'platform-secret-for-tests-only-0123456789abcdef'
const SLUG = 'club'
const ORIGIN = `http://${SLUG}.localhost`
const ROWS = `${ORIGIN}/api/v1/app/tables/3/rows`

let d1: LocalD1
let env: Env
let db: D1Database
beforeAll(async () => {
  d1 = await localD1()
  env = { ...d1.env, AUTH_SECRET: SECRET }
  db = d1.env.DB
}, 60_000)
afterAll(() => d1?.dispose())

let mailer: MemoryMailer
let tasks: Promise<unknown>[]
let app: ReturnType<typeof createApp>

beforeEach(async () => {
  mailer = new MemoryMailer()
  tasks = []
  app = createApp({ mailer: () => mailer })
  const tables = new D1AuthTables(db)
  for (const row of (await db.prepare('SELECT model_id FROM app_auth').all<{ model_id: string }>()).results) await tables.drop(row.model_id)
  await db.exec('DELETE FROM models; DELETE FROM rows; DELETE FROM sampled_tables; DELETE FROM apps; DELETE FROM versions; DELETE FROM publishing')
})

const ctx = { waitUntil: (p: Promise<unknown>) => void tasks.push(p), passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext
const request = (url: string, init?: RequestInit) => app.fetch(new Request(url.startsWith('/') ? `${BUILDER}${url}` : url, init), env, ctx)
const json = (method: string, body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

/** A model with a page, a Database table (id 3) with these rules, a second one (id 4) set to keep a deleted person's rows, and sign-in unless `signIn` is false. */
function model(rules: Record<string, InputValue>, signIn: Record<string, InputValue> | false = {}): AppModel {
  return {
    version: 2,
    name: 'Club',
    features: [
      { feature: 'PageFeature', id: '1', inputs: { name: 'Home' }, placement: { parent: '$root', slot: 'content' } },
      ...(signIn ? [{ feature: SIGN_IN_FEATURE, id: '2', inputs: signIn }] : []),
      {
        feature: 'DatabaseTableFeature',
        id: '3',
        inputs: { name: 'Bookings', fields: ['title: text, required'], sample_rows: '[{"title": "Sample"}]', ...rules },
      },
      {
        feature: 'DatabaseTableFeature',
        id: '4',
        inputs: { name: 'Notes', fields: ['text: text'], deleted_accounts: 'keep', ...(signIn ? { add_rows: 'signed-in' } : {}) },
      },
    ],
  }
}

/** Stores and publishes a model at club.localhost; returns its id. */
async function publish(m: AppModel): Promise<string> {
  const stored = await request('/api/v1/models', json('POST', m))
  const { id } = (await stored.json()) as { id: string }
  expect((await request(`/api/v1/models/${id}/publish`, json('POST', { slug: SLUG }, { 'If-Match': stored.headers.get('ETag')! }))).status).toBe(200)
  return id
}

/** Signs in on the app with an emailed code (each person from an address of their own); returns the Cookie header. */
async function signIn(email: string): Promise<string> {
  const headers = { 'Content-Type': 'application/json', Origin: ORIGIN, 'cf-connecting-ip': `203.0.113.${email.length}` }
  const auth = (path: string, body: unknown) => request(`${ORIGIN}/api/v1/app/auth${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  expect((await auth('/email-otp/send-verification-otp', { email, type: 'sign-in' })).status).toBe(200)
  await Promise.all(tasks)
  const otp = /is (\d{6})\./.exec(mailer.sent.at(-1)!.text)![1]
  const signed = await auth('/sign-in/email-otp', { email, otp })
  expect(signed.status).toBe(200)
  return signed.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

const as = (cookie?: string): Record<string, string> => (cookie ? { Cookie: cookie } : {})
const list = (cookie?: string, url = ROWS) => request(url, { headers: as(cookie) })
const add = (title: string, cookie?: string, url = ROWS) => request(url, json('POST', { title }, as(cookie)))
const change = (id: string, title: string, cookie?: string) => request(`${ROWS}/${id}`, json('PATCH', { title }, as(cookie)))
const remove = (id: string, cookie?: string) => request(`${ROWS}/${id}`, { method: 'DELETE', headers: as(cookie) })
const titles = async (answer: Response) => ((await answer.json()) as { title: string }[]).map((r) => r.title)
const owners = async () => (await db.prepare('SELECT created_by FROM rows WHERE table_key = ? ORDER BY created_at, rowid').bind('3').all()).results

describe('a table open to anyone (every table before rules)', () => {
  it('lets anyone do anything, and remembers who added a row only when someone signed in did, never saying so', async () => {
    await publish(model({}))
    expect(await titles(await list())).toEqual(['Sample'])
    const anon = await add('Anyone’s')
    expect(anon.status).toBe(201)
    const ann = await signIn('ann@example.com')
    const mine = await add('Ann’s', ann)
    const row = (await mine.json()) as Record<string, unknown>
    expect(row).not.toHaveProperty('created_by')
    expect(await owners()).toEqual([{ created_by: null }, { created_by: null }, { created_by: expect.any(String) }])
    const listed = (await (await list(ann)).json()) as Record<string, unknown>[]
    expect(listed.every((r) => !('created_by' in r))).toBe(true)
    expect((await change(row.id as string, 'Changed by anyone')).status).toBe(200)
    expect((await remove(row.id as string)).status).toBe(204)
  })

  it('adds rows for people signed out even when the app’s sign-in can’t be checked, reading no session without its cookie', async () => {
    await publish(model({}))
    const answer = await add('Anyone’s')
    expect(answer.status).toBe(201)
    expect(answer.headers.get('Vary')).toBeNull()
    // No secret (sign-in can't be checked): a row added by anyone is still added, by no one.
    env = { ...env, AUTH_SECRET: undefined as unknown as string }
    try {
      expect((await add('Still anyone’s', 'fd.session_token=whatever')).status).toBe(201)
    } finally {
      env = { ...env, AUTH_SECRET: SECRET }
    }
  })

  it('in an app without sign-in reads no session at all', async () => {
    await publish(model({}, false))
    const answer = await add('Anyone’s')
    expect(answer.status).toBe(201)
    expect(answer.headers.get('Vary')).toBeNull()
  })
})

describe('signed in', () => {
  it('asks people signed out to sign in (a 401), and the answer is never for a shared cache', async () => {
    await publish(model({ see_rows: 'signed-in', add_rows: 'signed-in' }))
    const refused = await list()
    expect(refused.status).toBe(401)
    expect(await refused.json()).toEqual({ error: "Sign in to see this table's rows" })
    expect(refused.headers.get('Cache-Control')).toContain('private')
    expect((await add('Anonymous')).status).toBe(401)
    const ann = await signIn('ann@example.com')
    expect((await add('Ann’s', ann)).status).toBe(201)
    const answer = await list(ann)
    expect(await titles(answer)).toEqual(['Sample', 'Ann’s'])
    expect(answer.headers.get('Cache-Control')).toBe('private, no-store')
    expect(answer.headers.get('Vary')).toBe('Cookie')
  })

  it('stores no sample rows for a request it refuses', async () => {
    await publish(model({ see_rows: 'signed-in' }))
    expect((await list()).status).toBe(401)
    expect(await db.prepare('SELECT count(*) AS n FROM sampled_tables').first('n')).toBe(0)
  })

  it('refuses everyone in an app without sign-in, saying why (a version published before that was an error)', async () => {
    // Such a model isn't published: its table's rules need a Sign-in feature.
    const stored = await request('/api/v1/models', json('POST', model({ add_rows: 'signed-in' }, false)))
    const { id } = (await stored.json()) as { id: string }
    const publishing = await request(`/api/v1/models/${id}/publish`, json('POST', { slug: SLUG }, { 'If-Match': stored.headers.get('ETag')! }))
    expect(publishing.status).toBe(400)
    expect(JSON.stringify(await publishing.json())).toContain('Its rules need people to sign in')
    await new D1AppStore(db).publish(id, SLUG, model({ add_rows: 'signed-in' }, false))
    const refused = await add('Anyone’s')
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ error: "Only people signed in can add this table's rows, and this app has no sign-in" })
  })
})

describe('owner', () => {
  it('lets only the person who added a row change or delete it', async () => {
    await publish(model({ add_rows: 'signed-in', change_rows: 'owner', delete_rows: 'owner' }))
    const ann = await signIn('ann@example.com')
    const bo = await signIn('bo@example.com')
    const { id } = (await (await add('Ann’s', ann)).json()) as { id: string }
    for (const refused of [await change(id, 'Bo was here', bo), await remove(id, bo)]) {
      expect(refused.status).toBe(403)
      expect(((await refused.json()) as { error: string }).error).toMatch(/^Only the person who added a row can (change|delete) it$/)
    }
    expect((await change(id, 'Bo was here')).status).toBe(401)
    // Seen by everyone, so the sample row (added by no one) is anyone's to see, and no one's to change.
    expect(await titles(await list(bo))).toEqual(['Sample', 'Ann’s'])
    const [sample] = (await (await list()).json()) as { id: string }[]
    expect((await change(sample!.id, 'Mine now', ann)).status).toBe(403)
    expect((await change(id, 'Ann’s, changed', ann)).status).toBe(200)
    expect((await remove(id, ann)).status).toBe(204)
    expect(await titles(await list())).toEqual(['Sample'])
    // A row that is gone is gone, whoever deletes it.
    expect((await remove(id, bo)).status).toBe(204)
  })

  it('shows each person only their own rows, and another’s row is as good as missing', async () => {
    await publish(model({ see_rows: 'owner', add_rows: 'signed-in', change_rows: 'owner', delete_rows: 'owner' }))
    const ann = await signIn('ann@example.com')
    const bo = await signIn('bo@example.com')
    const { id } = (await (await add('Ann’s', ann)).json()) as { id: string }
    await add('Bo’s', bo)
    expect(await titles(await list(ann))).toEqual(['Ann’s'])
    expect(await titles(await list(bo))).toEqual(['Bo’s'])
    expect((await list()).status).toBe(401)
    expect((await request(`${ROWS}/${id}`, { headers: as(ann) })).status).toBe(200)
    for (const answer of [await request(`${ROWS}/${id}`, { headers: as(bo) }), await change(id, 'Bo was here', bo), await remove(id, bo)])
      expect(answer.status).toBe(404)
    expect(await titles(await list(ann))).toEqual(['Ann’s'])
  })
})

describe('changing or deleting what one may not see', () => {
  it('is as good as missing for rows only their owner sees, whatever the change rule', async () => {
    await publish(model({ see_rows: 'owner', add_rows: 'signed-in', change_rows: 'signed-in', delete_rows: 'signed-in' }))
    const ann = await signIn('ann@example.com')
    const bo = await signIn('bo@example.com')
    const { id } = (await (await add('Ann’s', ann)).json()) as { id: string }
    const changing = await change(id, 'Bo was here', bo)
    expect(changing.status).toBe(404)
    expect(await changing.text()).not.toContain('Ann’s')
    expect((await remove(id, bo)).status).toBe(404)
    expect(await titles(await list(ann))).toEqual(['Ann’s'])
    expect((await change(id, 'Ann’s, changed', ann)).status).toBe(200)
  })

  it('is refused where no one may see the rows', async () => {
    await publish(model({ see_rows: 'nobody', add_rows: 'signed-in' }))
    const ann = await signIn('ann@example.com')
    const { id } = (await (await add('Ann’s', ann)).json()) as { id: string }
    expect((await change(id, 'Changed', ann)).status).toBe(403)
    expect((await remove(id, ann)).status).toBe(403)
  })

  it('asks people signed out to sign in where only people signed in see the rows', async () => {
    await publish(model({ see_rows: 'signed-in' }))
    const ann = await signIn('ann@example.com')
    const [sample] = (await (await list(ann)).json()) as { id: string }[]
    expect((await change(sample!.id, 'Changed')).status).toBe(401)
    expect((await remove(sample!.id)).status).toBe(401)
  })
})

describe('no one', () => {
  it('refuses everyone, the person who added the row too', async () => {
    await publish(model({ add_rows: 'signed-in', delete_rows: 'nobody', change_rows: 'nobody' }))
    const ann = await signIn('ann@example.com')
    const { id } = (await (await add('Ann’s', ann)).json()) as { id: string }
    const refused = await remove(id, ann)
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ error: "No one can delete this table's rows" })
    expect((await change(id, 'Changed', ann)).status).toBe(403)
  })
})

describe("the builder's draft rows", () => {
  it('apply no rules: the editor and preview work on them freely', async () => {
    const stored = await request('/api/v1/models', json('POST', model({ see_rows: 'nobody', add_rows: 'nobody' })))
    const { id } = (await stored.json()) as { id: string }
    const draft = `/api/v1/models/${id}/tables/3/rows`
    expect((await add('Draft', undefined, draft)).status).toBe(201)
    expect(await titles(await list(undefined, draft))).toEqual(['Sample', 'Draft'])
  })
})

describe('a person’s own rows', () => {
  it('are in what they download, by table, without who added them; only from the app’s own page', async () => {
    await publish(model({ add_rows: 'signed-in' }))
    const ann = await signIn('ann@example.com')
    const bo = await signIn('bo@example.com')
    await add('Ann’s', ann)
    await add('Bo’s', bo)
    await request(`${ORIGIN}/api/v1/app/tables/4/rows`, json('POST', { text: 'Ann’s note' }, as(ann)))
    const download = (headers: Record<string, string>) => request(`${ORIGIN}/api/v1/app/account`, { headers: { ...as(ann), ...headers } })
    const answer = await download({ 'Sec-Fetch-Site': 'same-origin' })
    expect(answer.status).toBe(200)
    const { rows } = (await answer.json()) as { rows: { table: string; rows: Record<string, unknown>[] }[] }
    expect(rows).toEqual([
      { table: 'Bookings', rows: [expect.objectContaining({ title: 'Ann’s' })] },
      { table: 'Notes', rows: [expect.objectContaining({ text: 'Ann’s note' })] },
    ])
    expect(JSON.stringify(rows)).not.toContain('created_by')
    expect((await download({ 'Sec-Fetch-Site': 'none' })).status).toBe(200)
    for (const site of ['cross-site', 'same-site']) {
      const refused = await download({ 'Sec-Fetch-Site': site })
      expect(refused.status).toBe(403)
      expect(await refused.json()).toEqual({ error: "Your data is downloaded from the app's own page" })
    }
  })

  it('go with their account, except in a table set to keep them, which keeps them without their name', async () => {
    await publish(model({ add_rows: 'signed-in' }))
    const ann = await signIn('ann@example.com')
    const bo = await signIn('bo@example.com')
    await add('Ann’s', ann)
    await add('Bo’s', bo)
    const notes = `${ORIGIN}/api/v1/app/tables/4/rows`
    await request(notes, json('POST', { text: 'Ann’s note' }, as(ann)))
    const deleted = await request(`${ORIGIN}/api/v1/app/auth/delete-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: ann },
      body: '{}',
    })
    expect(deleted.status).toBe(200)
    expect(await titles(await list())).toEqual(['Sample', 'Bo’s'])
    const kept = (await (await request(notes)).json()) as { text: string }[]
    expect(kept.map((r) => r.text)).toEqual(['Ann’s note'])
    expect(await db.prepare("SELECT created_by FROM rows WHERE table_key = '4'").first('created_by')).toBeNull()
  })
})
