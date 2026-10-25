import { HTTP_METHODS, proxyAddresses, type AppModel } from '@feature-domain/engine'
import { bodyLimit } from 'hono/body-limit'
import { isPlatformHost, type Hosts } from './hosts'
import { error, sendsJson } from './http'

// /api/v1/proxy: fetches an address for a page, for sites that don't let other pages read them. Never an open proxy:
// only addresses on the origins of the model's own Server resources (the engine's proxyAddresses), on public hosts.

export const PROXY_LIMITS = {
  /** The request as the page sends it (the address and the values a form sends). */
  requestBytes: 1_000_000,
  /** The answer passed back; a larger one is refused. */
  responseBytes: 5_000_000,
  timeoutMs: 10_000,
  redirects: 3,
}

/** Marks answers made by the proxy itself (its errors), so a page can tell them from the site's own. */
export const PROXY_ERROR_HEADER = 'X-Proxy-Error'

/** Marks the site's answers the proxy passes on (`site`), so a page can tell them from anything else on the way. */
export const PROXY_ANSWER_HEADER = 'X-Proxy-Answer'

const USER_AGENT = 'feature-domain-proxy (+https://github.com/tbeauvais/feature_domain)'

/**
 * What a page asks the proxy for: the same shape as the web app's DataRequest, plus the model it comes from (on the
 * builder; a published app's model is the one its host serves, never what the page says).
 */
export interface ProxyRequest {
  model?: string
  method: (typeof HTTP_METHODS)[number]
  url: string
  body?: Record<string, string | number | boolean | null>
  requestType?: 'form' | 'multipart'
}

/** A failure, in words, with the status the proxy answers with. */
export class ProxyError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 413 | 502 | 504,
    message: string,
  ) {
    super(message)
  }
}

/**
 * The request the page sent, or a 400 saying what is wrong with it. With `model` false (a published app's proxy), a
 * model in it is refused rather than read.
 */
export function readProxyRequest(value: unknown, { model: named = true } = {}): ProxyRequest {
  const bad = (message: string) => new ProxyError(400, message)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw bad(`Send { ${named ? 'model, ' : ''}method, url, body?, requestType? }`)
  const { model, method, url, body, requestType } = value as Record<string, unknown>
  if (named && (typeof model !== 'string' || model === '')) throw bad('model must be the id of a model')
  if (!named && model !== undefined) throw bad("An app's proxy fetches for the app itself: send no model")
  if (typeof method !== 'string' || !(HTTP_METHODS as readonly string[]).includes(method)) throw bad(`method must be one of ${HTTP_METHODS.join(', ')}`)
  if (typeof url !== 'string') throw bad('url must be an address')
  if (requestType !== undefined && requestType !== 'form' && requestType !== 'multipart') throw bad('requestType must be "form" or "multipart"')
  const request: ProxyRequest = { method: method as ProxyRequest['method'], url }
  if (named) request.model = model as string
  if (requestType) request.requestType = requestType
  if (body !== undefined) {
    if (method === 'GET') throw bad('A GET request has no body')
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw bad('body must be an object of values')
    for (const v of Object.values(body))
      if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) throw bad('body values must be text, numbers, true/false or null')
    request.body = body as ProxyRequest['body']
  }
  return request
}

/** Where the proxy is answering: the page's own host, and the platform's (the builder and every app). */
export interface ProxySite {
  self: string
  hosts: Hosts
}

/**
 * Hosts the proxy never fetches from: addresses, names that only mean something on a local network, this site, and the
 * platform's own hosts, so a page can't reach the builder or another app through it.
 */
function refusedHost(hostname: string, { self, hosts }: ProxySite): string | undefined {
  // `localhost.` is localhost: a trailing dot would slip past the checks below.
  if (hostname.endsWith('.')) return 'Names ending in a dot are'
  if (hostname.startsWith('[') || /^\d+(\.\d+){3}$/.test(hostname)) return 'IP addresses are'
  if (!hostname.includes('.') || /\.(localhost|local|internal|home\.arpa|localdomain)$/.test(hostname)) return 'Local names are'
  if (hostname === self) return 'This site is'
  if (isPlatformHost(hostname, hosts)) return "This platform's own sites are"
  return undefined
}

/**
 * The address as a URL when the proxy may fetch it: http(s) on the default port, no user name or password, a public
 * host other than this site's and the platform's, on the origin of one of `allowed` (the model's Server addresses).
 */
export function checkTarget(address: string, allowed: ReadonlySet<string>, site: ProxySite): URL {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    throw new ProxyError(400, `"${address}" is not an address`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ProxyError(400, 'Only http(s) addresses can be fetched')
  if (url.username || url.password) throw new ProxyError(400, 'Addresses with a user name or password are not fetched')
  if (url.port) throw new ProxyError(403, `Only the standard port is fetched, not ${url.port}`)
  const refused = refusedHost(url.hostname, site)
  if (refused) throw new ProxyError(403, `${refused} never fetched`)
  if (!allowed.has(url.origin)) throw new ProxyError(403, "It isn't one of this model's addresses fetched through the server")
  return url
}

/** The origins of a model's Server addresses (ones that aren't addresses are left out). */
export function allowedOrigins(model: AppModel): Set<string> {
  const origins = new Set<string>()
  for (const address of proxyAddresses(model)) {
    try {
      origins.add(new URL(address).origin)
    } catch {
      // Not an address: nothing to allow.
    }
  }
  return origins
}

/** The body to send, encoded as the request says: form-encoded, multipart form data, or JSON. */
function encode({ body, requestType }: ProxyRequest): { body?: BodyInit; type?: string } {
  if (!body) return {}
  const pairs = Object.entries(body).map(([k, v]): [string, string] => [k, v === null ? '' : String(v)])
  if (requestType === 'form') return { body: new URLSearchParams(pairs) }
  if (requestType === 'multipart') {
    const data = new FormData()
    for (const [k, v] of pairs) data.append(k, v)
    return { body: data }
  }
  return { body: JSON.stringify(body), type: 'application/json' }
}

const REDIRECTS = new Set([301, 302, 303, 307, 308])

/**
 * Fetches the request's address (each redirect checked like the address itself) and answers with the site's status,
 * its Content-Type and its body, at most PROXY_LIMITS.responseBytes. Nothing from the page's own request (cookies,
 * Cloudflare Access's headers) is sent on.
 */
export async function forward(request: ProxyRequest, allowed: ReadonlySet<string>, site: ProxySite, upstream: typeof fetch): Promise<Response> {
  let url = checkTarget(request.url, allowed, site)
  let method: string = request.method
  let { body, type } = encode(request)
  const signal = AbortSignal.timeout(PROXY_LIMITS.timeoutMs)
  try {
    for (let hop = 0; ; hop++) {
      const headers: Record<string, string> = { Accept: 'application/json, */*;q=0.8', 'User-Agent': USER_AGENT }
      if (type) headers['Content-Type'] = type
      const response = await upstream(url.href, { method, headers, body, redirect: 'manual', signal })
      const location = response.headers.get('Location')
      if (!REDIRECTS.has(response.status) || location === null) return await passOn(response)
      await response.body?.cancel()
      if (hop >= PROXY_LIMITS.redirects) throw new ProxyError(502, `The site redirected more than ${PROXY_LIMITS.redirects} times`)
      let next: URL
      try {
        next = checkTarget(new URL(location, url).href, allowed, site)
      } catch (e) {
        throw new ProxyError(502, `The site redirected somewhere the proxy doesn't fetch (${e instanceof Error ? e.message : String(e)})`)
      }
      // As browsers do: a 303 (and a 301 or 302 after a POST) is followed with a GET, without the body.
      if (response.status === 303 || (method === 'POST' && (response.status === 301 || response.status === 302))) {
        method = 'GET'
        body = undefined
        type = undefined
      }
      url = next
    }
  } catch (e) {
    if (e instanceof ProxyError) throw e
    if (signal.aborted) throw new ProxyError(504, `The site didn't answer within ${PROXY_LIMITS.timeoutMs / 1000} s`)
    throw new ProxyError(502, "Couldn't reach the site")
  }
}

/** The site's answer as the proxy passes it on. */
async function passOn(response: Response): Promise<Response> {
  const headers = new Headers({ [PROXY_ANSWER_HEADER]: 'site' })
  const type = response.headers.get('Content-Type')
  if (type) headers.set('Content-Type', type)
  if ([204, 205, 304].includes(response.status)) {
    await response.body?.cancel()
    return new Response(null, { status: response.status, headers })
  }
  const tooLarge = () => new ProxyError(502, `The site answered with more than ${PROXY_LIMITS.responseBytes / 1_000_000} MB`)
  // A quick refusal for an announced size. Fetch decodes compressed answers, so Content-Length may count the compressed
  // bytes: the count while reading below is the real check.
  if (Number(response.headers.get('Content-Length') ?? 0) > PROXY_LIMITS.responseBytes) {
    await response.body?.cancel()
    throw tooLarge()
  }
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = response.body?.getReader()
  for (let read = await reader?.read(); read && !read.done; read = await reader!.read()) {
    size += read.value.byteLength
    if (size > PROXY_LIMITS.responseBytes) {
      await reader!.cancel()
      throw tooLarge()
    }
    chunks.push(read.value)
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.byteLength
  }
  return new Response(bytes, { status: response.status, headers })
}

/** A proxy error: marked, so the page can tell it from the site's own answers. */
export function proxyError(status: number, message: string, allow?: string): Response {
  return error(status, message, { allow, headers: { [PROXY_ERROR_HEADER]: 'true' } })
}

/** The largest request the proxy reads (a 413 past it). */
export const proxyLimit = bodyLimit({
  maxSize: PROXY_LIMITS.requestBytes,
  onError: () => proxyError(413, `Requests through the proxy are limited to ${PROXY_LIMITS.requestBytes} bytes`),
})

/**
 * Answers a proxy request, the builder's or an app's: JSON only (so a form on another site can't send one), read with
 * `readProxyRequest` (`named`: whether it names its model), fetched if `allowedFor` (the model's Server origins; it may
 * throw a `ProxyError`) allows it, from `site`. Its own errors are marked.
 */
export async function answerProxy(
  request: Request,
  named: boolean,
  allowedFor: (request: ProxyRequest) => Promise<ReadonlySet<string>>,
  site: ProxySite,
  upstream: typeof fetch,
): Promise<Response> {
  try {
    if (!sendsJson(request)) throw new ProxyError(400, 'Send the request as application/json')
    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw new ProxyError(400, 'The body is not valid JSON')
    }
    const read = readProxyRequest(body, { model: named })
    return await forward(read, await allowedFor(read), site, upstream)
  } catch (e) {
    if (e instanceof ProxyError) return proxyError(e.status, e.message)
    throw e
  }
}
