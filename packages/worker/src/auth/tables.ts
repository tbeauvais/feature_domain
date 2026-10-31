// Each published app with sign-in has Better Auth tables of its own in the one D1 database, named after the app's key
// (app_<key>_user, …), so no query Better Auth makes can reach another app's accounts. (Spike: Data Apps iteration 3.)

/** The table names of one app's auth tables. */
export interface AuthTables {
  user: string
  session: string
  account: string
  verification: string
  rateLimit: string
}

const KEY = /^[0-9a-f]{32}$/

/** A new random key: 32 hex characters. */
export function newAuthKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export const isAuthKey = (key: unknown): key is string => typeof key === 'string' && KEY.test(key)

/** The app's table names, built only from a stored key: anything else throws, so no name comes from a request. */
export function authTables(key: string): AuthTables {
  if (!isAuthKey(key)) throw new Error('Not an auth key')
  const p = `app_${key}_`
  return { user: `${p}user`, session: `${p}session`, account: `${p}account`, verification: `${p}verification`, rateLimit: `${p}rate_limit` }
}

/** Every auth table, children first (the order to drop them in). */
export const tablesOf = (t: AuthTables) => [t.session, t.account, t.verification, t.rateLimit, t.user]

/**
 * The schema, as steps: each returns the statements bringing an app's tables from one version to the next. They only
 * add, so they work with the Worker already running. Step 1 is what Better Auth 1.7.14 creates with these table names
 * (`getMigrations`, spike/schema.mts); a test checks it still matches.
 */
export type AuthSchemaStep = (t: AuthTables) => string[]

export const AUTH_SCHEMA_STEPS: AuthSchemaStep[] = [
  (t) => [
    `CREATE TABLE "${t.user}" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null)`,
    `CREATE TABLE "${t.session}" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "${t.user}" ("id") on delete cascade)`,
    `CREATE TABLE "${t.account}" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "${t.user}" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null)`,
    `CREATE TABLE "${t.verification}" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null)`,
    `CREATE TABLE "${t.rateLimit}" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null)`,
    `CREATE INDEX "${t.session}_userId_idx" ON "${t.session}" ("userId")`,
    `CREATE INDEX "${t.account}_userId_idx" ON "${t.account}" ("userId")`,
    `CREATE INDEX "${t.verification}_identifier_idx" ON "${t.verification}" ("identifier")`,
  ],
]
