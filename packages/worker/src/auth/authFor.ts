// Better Auth for one published app: its own tables, its own secret, its exact address. Built per request (src/auth/
// route.ts), so nothing of one app's configuration can serve another.

import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { emailOTP } from 'better-auth/plugins/email-otp'
import type { Mailer } from './mailer'
import { authTables } from './tables'

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
  /** The app's name, which its emails come from. */
  appName: string
  mailer: Mailer
  /** Whether people without an account may make one by signing in (else only existing accounts get a code). */
  signUp?: boolean
  /** Whether an address may sign in at all (listed emails and domains); others get no email, and the same answer. */
  allows?: (email: string) => boolean
  /** Keeps work going after the response (the request's ctx.waitUntil). */
  waitUntil: (promise: Promise<unknown>) => void
  /** Turns on the signed session cookie cache. */
  cookieCache?: boolean
  /**
   * Deletes or keeps (without their name) the rows a person added: before their account is deleted (if it fails, the
   * account stays, and deleting it again tries again), and again once it is gone (`gone`), which also remembers them, so
   * no row a request still on its way adds lands in their name.
   */
  forgetUser?: (userId: string, gone: boolean) => Promise<void>
}

export const AUTH_BASE_PATH = '/api/v1/app/auth'

/** The apps' cookie names start with this (`__Host-` before it on https): the session's is `<prefix>.session_token`. */
export const COOKIE_PREFIX = 'fd'
const HOST_COOKIE_PREFIX = `__Host-${COOKIE_PREFIX}`

/** Whether a request carries an app's session cookie (it may have expired: only a session read says). */
export function hasSessionCookie(request: Request): boolean {
  const names = (request.headers.get('Cookie') ?? '').split(';').map((c) => c.trim().split('=')[0])
  return names.some((n) => n === `${COOKIE_PREFIX}.session_token` || n === `${HOST_COOKIE_PREFIX}.session_token`)
}

/** Better Auth's answer to a wrong code (the email-code plugin's INVALID_OTP), given to a refused address too. */
const INVALID_OTP = { code: 'INVALID_OTP', message: 'Invalid OTP' }

/** The longest app name an email shows. */
export const MAX_MAIL_NAME = 60

/**
 * The app's name as its emails show it: one line of printable text, at most MAX_MAIL_NAME characters, never empty.
 * (Models can be named anything, newlines included; a mail header can't hold those.)
 */
export function mailName(name: string): string {
  const line = name
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const cut = [...line].slice(0, MAX_MAIL_NAME).join('').trim()
  return cut || 'An app'
}

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
    // Delete my account: Better Auth asks for a recent sign-in (a day, its default freshAge) before deleting.
    user: {
      modelName: t.user,
      deleteUser: {
        enabled: true,
        ...(options.forgetUser
          ? {
              beforeDelete: (user: { id: string }) => options.forgetUser!(user.id, false),
              afterDelete: (user: { id: string }) => options.forgetUser!(user.id, true),
            }
          : {}),
      },
    },
    session: { modelName: t.session, cookieCache: { enabled: options.cookieCache ?? false, maxAge: 300 } },
    account: { modelName: t.account },
    verification: { modelName: t.verification },
    // Kept in the app's own table, so every isolate counts alike. Only what can send mail or guess codes is limited:
    // otherwise each session read would cost two more D1 statements.
    rateLimit: { enabled: true, storage: 'database', modelName: t.rateLimit, customRules: { '/get-session': false, '/sign-out': false } },
    advanced: {
      // Off: by default every new instance introspects the whole database (sqlite_master, then every table's columns)
      // and auth requests wait for it. Built per request, over thousands of apps' tables, that would be every request.
      // The schema is checked in CI instead (the drift test).
      database: { validateSchema: false },
      backgroundTasks: { handler: options.waitUntil },
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      // __Host- names on https: host-only (no Domain), Path=/ and Secure, so no other site can set them. Better Auth
      // would otherwise use __Secure-, which a sibling subdomain could still set. Plain names over http (development).
      ...(https ? { cookiePrefix: HOST_COOKIE_PREFIX, useSecureCookies: false, defaultCookieAttributes: { secure: true } } : { cookiePrefix: COOKIE_PREFIX }),
    },
    // An address the app no longer allows can't use a code it was sent while it did: refused as a wrong code would be.
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email-otp' || !options.allows) return
        const email = (ctx.body as { email?: unknown } | undefined)?.email
        if (typeof email !== 'string' || !options.allows(email)) throw APIError.from('BAD_REQUEST', INVALID_OTP)
      }),
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 3,
        // An unknown address then gets no code, the same answer, and "invalid code" on signing in, as for a wrong code.
        disableSignUp: options.signUp === false,
        // Better Auth runs this through the background-task handler (ctx.waitUntil), so the answer doesn't wait for the
        // mail, nor shows whether one was sent. The button's link carries the code after `#`, which browsers never send,
        // so no server log holds it.
        // Every email says which address it is for and that it comes through the platform, so an app named after another
        // brand can't pass for it.
        async sendVerificationOTP({ email, otp }) {
          if (options.allows && !options.allows(email)) return
          const name = mailName(options.appName)
          const host = new URL(options.baseURL).host
          const platform = host.slice(host.indexOf('.') + 1)
          const button = `${options.baseURL}/sign-in?email=${encodeURIComponent(email)}#code=${otp}`
          await options.mailer.send({
            to: email,
            fromName: `${name} via ${platform}`,
            subject: `Your sign-in code for ${name} (${host})`,
            text: `Your code for signing in to ${name} at ${host} is ${otp}. It works for 5 minutes.\n\nOr sign in with this link: ${button}\n\nIf you didn't ask to sign in, you can ignore this email. ${name} is an app published on ${platform}.`,
          })
        },
      }),
    ],
  } satisfies BetterAuthOptions
}
