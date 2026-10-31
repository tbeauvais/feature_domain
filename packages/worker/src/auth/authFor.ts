// Better Auth for one published app (spike): its own tables, its own secret, its exact address. Built per request, so
// nothing of one app's configuration can serve another.

import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { authTables } from './tables'

/** One email to send. */
export interface Mail {
  to: string
  subject: string
  text: string
}

/** Sends email: Cloudflare Email Sending in production, a list in tests. */
export interface Mailer {
  send(mail: Mail): Promise<void>
}

/** A mailer that keeps what it sends (tests and local development). */
export class MemoryMailer implements Mailer {
  readonly sent: Mail[] = []
  async send(mail: Mail) {
    this.sent.push(mail)
  }
}

/** The app's own secret: HKDF-SHA-256 of the platform's secret, with the app's key as its info. */
export async function appSecret(platformSecret: string, key: string): Promise<string> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(platformSecret), 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('feature-domain app auth'), info: new TextEncoder().encode(key) },
    base,
    256,
  )
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface AuthForOptions {
  db: D1Database
  /** The app's key (app_auth.key). */
  key: string
  /** The app's own secret (appSecret). */
  secret: string
  /** The app's address, exactly: https://<slug>.apprun.app (http://<slug>.localhost:5173 in development). */
  baseURL: string
  mailer: Mailer
  /** Keeps work going after the response (the request's ctx.waitUntil). */
  waitUntil: (promise: Promise<unknown>) => void
  /** Turns on the signed session cookie cache. */
  cookieCache?: boolean
}

export const AUTH_BASE_PATH = '/api/v1/app/auth'

export const authFor = (options: AuthForOptions) => betterAuth(authConfig(options))

/** The app's Better Auth configuration (the schema-drift test reads it too). */
export function authConfig(options: AuthForOptions) {
  const t = authTables(options.key)
  const https = options.baseURL.startsWith('https://')
  return {
    database: options.db,
    secret: options.secret,
    baseURL: options.baseURL,
    basePath: AUTH_BASE_PATH,
    trustedOrigins: [new URL(options.baseURL).origin],
    telemetry: { enabled: false },
    user: { modelName: t.user },
    session: { modelName: t.session, cookieCache: { enabled: options.cookieCache ?? false, maxAge: 300 } },
    account: { modelName: t.account },
    verification: { modelName: t.verification },
    rateLimit: { enabled: true, storage: 'database', modelName: t.rateLimit },
    advanced: {
      // Off: by default every new instance introspects the whole database (sqlite_master, then every table's columns)
      // and auth requests wait for it. Built per request, over thousands of apps' tables, that would be every request.
      // The schema is checked in CI instead (the drift test).
      database: { validateSchema: false },
      backgroundTasks: { handler: options.waitUntil },
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      // __Host- names on https: host-only (no Domain), Path=/ and Secure, so no other site can set them. Better Auth
      // would otherwise use __Secure-, which a sibling subdomain could still set. Plain names over http (development).
      ...(https ? { cookiePrefix: '__Host-fd', useSecureCookies: false, defaultCookieAttributes: { secure: true } } : { cookiePrefix: 'fd' }),
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 3,
        async sendVerificationOTP({ email, otp }) {
          const button = `${options.baseURL}/sign-in?email=${encodeURIComponent(email)}&code=${otp}`
          await options.mailer.send({ to: email, subject: `Your sign-in code: ${otp}`, text: `Your code is ${otp}. Or sign in here: ${button}` })
        },
      }),
    ],
  } satisfies BetterAuthOptions
}
