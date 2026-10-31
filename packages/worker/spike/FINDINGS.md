# Auth spike (Data Apps iteration 3, PR 0): findings

2026-10-31, Better Auth 1.7.14 (pinned exactly), wrangler 4.151.0 / local D1, Node 26. The plan is the
"Data Apps iteration 3: App sign-in" section of the Modernization Plan doc.

**Verdict: go**, with per-app auth tables in D1, up to a cap of 1,000 apps with sign-in (Cloudflare D1, below). One change to the plan:
`advanced.database.validateSchema: false` is required (finding 1).

## What was built

- `migrations/0006_app_auth.sql`: `app_auth(model_id, key, schema_version)`.
- `src/auth/tables.ts`: random 32-hex keys, `authTables(key)` (refuses anything else), the versioned DDL template
  (step 1 = what Better Auth creates for these names).
- `src/auth/store.ts`: `ensureAuthTables` (create, or apply missing steps; never drops) and `dropAuthTables`.
- `src/auth/authFor.ts`: Better Auth per app and request (per-app HKDF secret, email-code plugin, `waitUntil`,
  `cf-connecting-ip`, rate limits in the app's table, `__Host-` cookies on https), and `MemoryMailer`.
- Wired in behind a seam (`AppOptions.signIn`, off by default): a publish with sign-in ensures the tables before the
  app is served, `/api/v1/app/auth/*` on the app host serves the host's app only, deleting a model (and a publish that
  finds its model deleted) drops them.
- Tests: `test/auth-spike.test.ts` (16), `test/auth-schema.test.ts` (2, the schema-drift test). Scripts:
  `spike/schema.mts`, `spike/cost.mts`, `spike/scale.mts`, `spike/worker.ts` (+ `spike/wrangler.jsonc`).

## Gates

| Gate | Result |
| --- | --- |
| Sign-in on two apps with one email | Pass: two separate users, one row in each app's user table |
| Every Better Auth statement names only that app's tables | Pass, once schema validation is off (finding 1): every statement of sign-in, session read and sign-out names the app's prefix and no other |
| Cookies replayed on the other app, cookie cache on | Pass: refused. With one shared secret the cached cookie **is accepted** on the other app (test shows it), so per-app secrets are required |
| `__Host-` cookies on https | Pass: `__Host-fd.*`, Secure, Path=/, no Domain, and they sign in. Needs `cookiePrefix: '__Host-fd'`, `useSecureCookies: false`, `defaultCookieAttributes: { secure: true }` (Better Auth's own prefix is `__Secure-`) |
| Tables created by a publish; dropped with the model | Pass, through the real routes |
| Concurrent creation and upgrades | Pass without the claim: each change is one D1 batch, which is one transaction including DDL (tested: a failing statement takes a CREATE TABLE back), so a second request's batch fails and rolls back, and it reads the result. 6 concurrent creations: one key, five tables; 6 concurrent upgrades: no error |
| Runs in workerd without `nodejs_compat` | Pass: `spike/worker.ts` under `wrangler dev`, no compatibility flags: code sent via `waitUntil`, sign-in, session |
| Cost of building Better Auth per request | 0.04 ms to build; 0.38 ms build + first request vs 0.11 ms on an existing instance (in Node, no database). Building per request is fine |
| Sign-up atomicity | Not atomic: user insert, then session insert, separate statements (D1 has no interactive transactions; the adapter runs without them). A failure between leaves a user without a session; the next sign-in finds the user and makes one. Harmless |
| Rate limits | Pass: keyed `cf-connecting-ip|path` in the app's `_rate_limit` table; code requests: 200 200 200 then 429 |
| Schema drift | `getMigrations` over SQLite with our template reports nothing missing, and reports a column removed from the template |
| Scale | See below |

## Findings

1. **Better Auth introspects the whole database on every new instance** (`validateSchema`, default on): it reads
   `sqlite_master`, then every table's columns in one batch, and auth requests wait for it. Built per request over
   thousands of tables, that is every request. `advanced.database.validateSchema: false` turns it off; the drift test
   checks the schema in CI instead. (The plan said `getMigrations` must never run in production; this is the same
   introspection, run implicitly.)
2. **Per-app secrets are necessary**, confirmed (the review's finding 2).
3. **The claim isn't needed for DDL.** D1 batches are transactional, DDL included, so creating and upgrading are
   race-free on their own. Dropping on delete and on "deleted meanwhile" is still needed (done).
4. **Better Auth's database rate limiter costs two D1 statements on every auth request**, `get-session` included. PR 1b
   should limit it to the sign-in endpoints (`customRules`), and the rows API should read sessions through
   `auth.api.getSession` (server calls; check they skip the limiter) or the cookie cache.
5. **The sign-in response's JSON body carries the session token**, readable by page scripts though the cookie is
   HttpOnly. PR 1b should strip it (an `after` hook).
6. **Better Auth adds a cleanup of expired codes** (a select and a delete on the verification table) to code checks.
   Cheap, and keeps the table small.
7. **Empty auth tables take about 69 KB per app** (5 tables, 3 indexes, 7 automatic indexes, a 4 KB page each): 2,000
   apps = 138 MB of D1's 10 GB.

## Scale (local D1)

One local D1 database, apps added one at a time with `ensureAuthTables`:

| Apps (tables) | Create, ms/app | Auth read, ms | Rate-limit write, ms | `models` read, ms | File, MB |
| --- | --- | --- | --- | --- | --- |
| 1 (5) | 28.3 | 2.65 | 2.26 | 1.48 | 0.0 |
| 100 (500) | 7.2 | 1.69 | 1.48 | 1.14 | 5.0 |
| 500 (2,500) | 8.2 | 1.62 | 1.45 | 0.95 | 34.2 |
| 1,000 (5,000) | 14.0 | 1.47 | 1.35 | 0.96 | 69.8 |
| 1,500 (7,500) | 19.5 | 1.40 | 1.32 | 0.91 | 102.7 |
| 2,000 (10,000) | 25.0 | 1.45 | 1.34 | 0.97 | 138.2 |

At 2,000 apps: one `ALTER TABLE` (an app's, or `models`) 110 ms; `count(*)` over `sqlite_master` 4.5 ms; a full dump
0.3 s (4.1 MB of SQL).

A second run to 6,000 apps:

| Apps (tables) | Create, ms/app | Auth read, ms | `models` read, ms | File, MB |
| --- | --- | --- | --- | --- |
| 1,000 (5,000) | 11.4 | 2.19 | 0.97 | 68.1 |
| 2,000 (10,000) | 23.9 | 2.93 | 0.90 | 139.4 |
| 3,000 (15,000) | 35.6 | 1.54 | 2.76 | 208.2 |
| 4,000 (20,000) | 56.4 | 2.01 | 1.16 | 279.1 |
| 5,000 (25,000) | 67.2 | 1.47 | 1.09 | 348.1 |
| 6,000 (30,000) | 75.8 | 1.47 | 0.96 | 417.1 |

At 6,000 apps: one `ALTER TABLE` (an app's, or `models`) **750 ms**; `count(*)` over `sqlite_master` 9.5 ms; a full
dump 1.9 s (12.1 MB).

- **Reads and writes don't slow down** with the number of tables (1.3 to 2.9 ms throughout).
- **Schema changes do, and faster than the table count.** DDL rewrites and re-reads the whole schema: creating an app's
  tables goes from 7 ms (100 apps) to 25 ms (2,000) to 76 ms (6,000); one `ALTER` costs 110 ms at 10,000 tables and
  750 ms at 30,000 (three times the tables, seven times the cost). Every DDL statement in the database pays it,
  our own migrations on `models` included, and on D1 (one writer per database) it holds up every app's writes while it
  runs. `db:upgrade-apps` over 2,000 apps is about 4 minutes; over 6,000, about 75.

## Scale (Cloudflare D1)

A temporary D1 database (`fd-auth-spike-scale`, deleted afterwards), filled to 3,000 apps with `spike/scale-remote.mts`
and dropped back down with `spike/shrink-remote.mts`. Times are D1's own (`meta.duration`, time in the database); the
round trip from here added 65 to 210 ms.

| Apps (tables) | Create an app's tables, ms | Auth read, ms | One `ALTER TABLE`, ms | Size, MB |
| --- | --- | --- | --- | --- |
| 100 (500) | | | 11 | |
| 250 (1,250) | 5.0 | 0.17 | | 17.6 |
| 500 (2,500) | 13.9 | 0.18 | 57 | 35.0 |
| 1,000 (5,000) | 30.6 | 0.18 | 177 | 70.0 |
| 1,500 (7,500) | 51.4 | 0.47 | | 104.9 |
| 2,000 (10,000) | 72.0 | 0.19 | 480 | 139.8 |
| 2,500 (12,500) | 91.8 | 0.17 | | 174.7 |
| 3,000 (15,000) | 112.0 | 0.24 | 1,010 (`models`: 931) | 209.6 |

- **Reads don't slow down** (0.2 ms in D1 throughout). Size matches local: about 70 KB per app.
- **Schema changes are much slower than locally, and grow about as the square of the table count**: one `ALTER` takes
  57 ms at 500 apps, 177 ms at 1,000, 480 ms at 2,000 and about 1 s at 3,000. It applies to every DDL statement in the
  database, our own migrations on `models` included, and D1 runs one write at a time, so it holds up every app's writes
  and the builder's while it runs.
- **A large DDL batch can fail outright.** At 3,000 apps, dropping 10 apps' tables in one batch (50 `DROP TABLE`
  statements) hit D1's CPU limit: `D1 DB exceeded its CPU time limit and was reset`. DDL must go one app per batch,
  and stay well below that size.
- **Export and Time Travel weren't measured.** Their cost follows the size, which matches local (12 MB of SQL for
  30,000 empty tables).

## Public Suffix List

A draft is in `spike/PSL_REQUEST.md`. **Don't submit yet:** the list declines small or early projects ("projects not
serving more then thousands of users are quite likely to be declined") and wants more than 2 years left on the
registration, a role-based contact address and an abuse contact. Submit once apps serve thousands of people. Isolation
doesn't depend on it. Until then all `*.apprun.app` apps are one site to browsers, so SameSite=Lax cookies go with
requests from one app's page to another's; Better Auth checks the Origin against the app's exact address, rows accept
only JSON (a cross-origin JSON request needs a CORS preflight, which is refused), and app pages run no one's own scripts.

## Recommended cap

**1,000 apps with sign-in** (5,000 tables), with an alert at 750, on the remote numbers: there one `ALTER` takes about
180 ms and creating an app's tables about 30 ms. At 2,000 every schema change, ours included, holds up all writes for
about half a second, and an upgrade of every app's tables takes about 16 minutes of such pauses. Plan the Durable Object
path (an app's auth and rows in its own SQLite) before reaching the cap.
