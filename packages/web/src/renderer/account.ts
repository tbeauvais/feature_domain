import type { InjectionKey } from 'vue'
import { isSignInAnswer } from '../lib/signIn'
// A published app's sign-in, from its page: Better Auth's endpoints on the app's own host (the Worker's
// src/auth/route.ts), called with fetch (no client library: nothing else to load, and the CSP is unchanged).

/** Where the app's sign-in answers. */
export const APP_AUTH_PATH = '/api/v1/app/auth'
/** What the app holds about the person signed in, to download. */
export const APP_ACCOUNT_PATH = '/api/v1/app/account'
/** The app's sign-in page (the emailed button's link opens it, with the email and the code). */
export const SIGN_IN_PATH = '/sign-in'

/** The person signed in, as the app's session says. */
export interface Visitor {
  email: string
  name: string
}

/** Why a sign-in step failed, in words. */
export class SignInError extends Error {
  constructor(
    message: string,
    /** Better Auth's code, when it gave one (e.g. INVALID_OTP, SESSION_EXPIRED). */
    readonly code?: string,
  ) {
    super(message)
  }
}

/** The app has no sign-in (its version has no Sign-in feature): the Account shows nothing. */
export class NoSignIn extends Error {}

type Fetch = typeof fetch

/** How long a sign-in request, its answer's body included, may take before it fails (so no page waits forever). */
export const AUTH_TIMEOUT_MS = 20_000

const UNREACHABLE = "Couldn't reach the app. Check your connection and try again."
/** What an answer from Cloudflare Access (in front of apps until they are public) says: its session ended. */
const ACCESS_EXPIRED = 'Your sign-in to this site has expired. Reload the page to sign in again.'

/** Fetches with a time limit (aborting the body's read too), refusing Access's sign-in pages. */
async function request(fetchImpl: Fetch, url: string, init: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetchImpl(url, { ...init, credentials: 'same-origin', redirect: 'manual', signal: AbortSignal.timeout(AUTH_TIMEOUT_MS) })
  } catch {
    throw new SignInError(UNREACHABLE)
  }
  if (isSignInAnswer(response)) throw new SignInError(ACCESS_EXPIRED)
  return response
}

async function call(fetchImpl: Fetch, path: string, body?: unknown): Promise<unknown> {
  const response = await request(fetchImpl, `${APP_AUTH_PATH}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (response.status === 404) throw new NoSignIn()
  let answer: unknown
  try {
    answer = await response.json()
  } catch {
    // A success must be the app's JSON (else nothing was sent, or no one signed in); a failure is said by its status.
    if (response.ok) throw new SignInError(UNREACHABLE)
    answer = null
  }
  if (response.ok) return answer
  const { code, message, error } = (answer ?? {}) as { code?: string; message?: string; error?: string }
  throw new SignInError(failure(response.status, code, error ?? message), code)
}

/** What a failed step says. */
function failure(status: number, code: string | undefined, message: string | undefined): string {
  if (code === 'INVALID_OTP' || code === 'OTP_EXPIRED') return "That code isn't right, or it has expired. Check it, or ask for a new one."
  if (code === 'TOO_MANY_ATTEMPTS') return 'Too many tries with that code. Ask for a new one.'
  if (code === 'SESSION_EXPIRED') return 'For your safety, sign in again before deleting your account.'
  if (status === 429) return 'Too many tries. Wait a minute, then try again.'
  if (status === 503 && message) return message
  return `Something went wrong (${status}). Try again.`
}

/** The person signed in, null when no one is. Throws NoSignIn for an app without sign-in. */
export async function currentVisitor(fetchImpl: Fetch = fetch): Promise<Visitor | null> {
  const answer = (await call(fetchImpl, '/get-session')) as { user?: { email?: unknown; name?: unknown } } | null
  const email = answer?.user?.email
  if (typeof email !== 'string') return null
  return { email, name: typeof answer?.user?.name === 'string' ? answer.user.name : '' }
}

/** Emails a sign-in code (the app answers alike whether or not it sends one). */
export async function sendCode(email: string, fetchImpl: Fetch = fetch): Promise<void> {
  await call(fetchImpl, '/email-otp/send-verification-otp', { email, type: 'sign-in' })
}

/** Signs in with an emailed code. */
export async function signInWithCode(email: string, code: string, fetchImpl: Fetch = fetch): Promise<void> {
  await call(fetchImpl, '/sign-in/email-otp', { email, otp: code })
}

export async function signOut(fetchImpl: Fetch = fetch): Promise<void> {
  await call(fetchImpl, '/sign-out', {})
}

/** Deletes the account of the person signed in (Better Auth asks for a sign-in within the last day). */
export async function deleteAccount(fetchImpl: Fetch = fetch): Promise<void> {
  await call(fetchImpl, '/delete-user', {})
}

/** A plausible email address (the app checks it properly). */
export const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())

/** A sign-in code as typed or pasted: its six digits, else undefined. */
export function readCode(value: string): string | undefined {
  const digits = value.replace(/[\s-]/g, '')
  return /^\d{6}$/.test(digits) ? digits : undefined
}

/** What the sign-in form does once someone signs in (the app page provides it; else it opens the app afresh). */
export const SIGNED_IN: InjectionKey<() => void> = Symbol('signed-in')

/** The email and code the emailed button's link carries: `?email=…#code=…` (the code never reaches a server). */
export function linkedSignIn(location: { search: string; hash: string }): { email: string; code: string } {
  const email = new URLSearchParams(location.search).get('email') ?? ''
  const code = readCode(new URLSearchParams(location.hash.replace(/^#/, '')).get('code') ?? '') ?? ''
  return { email, code }
}

/** What the app holds about the person signed in, as a file to save (account.json). */
export async function downloadAccount(fetchImpl: Fetch = fetch): Promise<Blob> {
  const response = await request(fetchImpl, APP_ACCOUNT_PATH, { headers: { Accept: 'application/json' } })
  if (response.status === 401) throw new SignInError('You were signed out. Sign in again to download your data.')
  // Only the app's JSON is saved as the file, never some other page.
  if (!response.ok || !response.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))
    throw new SignInError(`Your data couldn't be downloaded (${response.status}). Try again.`)
  try {
    return await response.blob()
  } catch {
    throw new SignInError(UNREACHABLE)
  }
}
