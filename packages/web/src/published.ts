import { defaultRegistry, generate, migrate, signInOf, validateModel, type DocNode, type ThemeTokens } from '@feature-domain/engine'
import { isSignInAnswer } from './lib/signIn'

/** The path a published app's page reads its model from, on the app's own host. */
export const PUBLISHED_APP_PATH = '/api/v1/app'

/** How long reading the app may take before the page says it couldn't. */
export const PUBLISHED_APP_TIMEOUT_MS = 20_000

/** What a published app's page shows: the app, or why it can't. */
export type PublishedApp =
  /** `signIn`: the version has sign-in (a Sign-in feature that generates), so its sign-in page works. */
  | { status: 'ready'; id: string; name: string; root: DocNode; signIn: boolean }
  | { status: 'none' }
  | { status: 'signed-out' }
  /** The app is open only to people signed in (or listed, when `email`, signed in, isn't): its own sign-in, not Access. */
  | { status: 'sign-in'; app: string; email?: string; theme?: ThemeTokens }
  | { status: 'error'; message: string }

/**
 * Reads the app published at this host once (it never polls and never saves) and generates it, upgrading a model stored
 * before its features were ported in memory, as the preview does.
 */
export async function loadPublishedApp(fetchImpl: typeof fetch = fetch): Promise<PublishedApp> {
  let response: Response
  try {
    // An expired Cloudflare Access session answers with a redirect to its sign-in page.
    response = await fetchImpl(PUBLISHED_APP_PATH, {
      headers: { Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(PUBLISHED_APP_TIMEOUT_MS),
    })
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === 'TimeoutError'
    return { status: 'error', message: timedOut ? "The server didn't answer in time." : "Couldn't reach the server." }
  }
  if (isSignInAnswer(response)) return { status: 'signed-out' }
  if (response.status === 404) return { status: 'none' }
  const signIn = await appSignInAnswer(response)
  if (signIn) return signIn
  if (!response.ok) return { status: 'error', message: `The app couldn't be loaded (${response.status}).` }
  let model: unknown
  try {
    model = await response.json()
  } catch (e) {
    // The time allowed covers reading the answer too.
    if (e instanceof DOMException && e.name === 'TimeoutError') return { status: 'error', message: "The server didn't answer in time." }
    return { status: 'error', message: "The app couldn't be loaded: the server didn't answer with JSON." }
  }
  const problems = validateModel(model)
  if (problems.length > 0 || typeof (model as { id?: unknown }).id !== 'string')
    return { status: 'error', message: `The app couldn't be loaded: it isn't a valid model (${problems[0] ?? 'it has no id'}).` }
  try {
    const upgraded = migrate(model).model
    const result = generate(upgraded, defaultRegistry)
    const { root } = result
    // Publishing refuses a model with errors, but one can still show nothing (its only page disabled).
    if (root.children.length === 0) return { status: 'error', message: 'The app has no page to show.' }
    return { status: 'ready', id: upgraded.id!, name: upgraded.name, root, signIn: signInOf(result) !== null }
  } catch (e) {
    return { status: 'error', message: `The app couldn't be shown: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** The app's own answer asking for sign-in (a 401, or a 403 for someone it doesn't list): `{ error, sign_in }`. */
async function appSignInAnswer(response: Response): Promise<PublishedApp | undefined> {
  if ((response.status !== 401 && response.status !== 403) || !response.headers.get('Content-Type')?.includes('application/json')) return undefined
  try {
    const body = (await response.clone().json()) as { sign_in?: { app?: unknown; email?: unknown; theme?: unknown } } | null
    const app = body?.sign_in?.app
    if (typeof app !== 'string') return undefined
    const { email, theme } = body!.sign_in!
    return {
      status: 'sign-in',
      app,
      ...(typeof email === 'string' ? { email } : {}),
      ...(isThemeTokens(theme) ? { theme } : {}),
    }
  } catch {
    return undefined
  }
}

/** Theme tokens as the Worker sends them (custom properties and component styles, all text). */
function isThemeTokens(value: unknown): value is ThemeTokens {
  const t = value as Partial<ThemeTokens> | undefined
  const allText = (o: unknown) => typeof o === 'object' && o !== null && Object.values(o).every((v) => typeof v === 'string')
  return typeof t?.scheme === 'string' && Array.isArray(t.adjustments) && allText(t.vars) && allText(t.styles)
}
