// Which site a request is for, by its host: the builder (the editor and its API), or a published app at
// <slug>.<app domain>. Anything else gets nothing, so a wrong setting can never serve the builder on an app's address.

export interface Hosts {
  /** The builder's hostname: app.feature-domain.workers.dev (localhost in development). */
  builder: string
  /** The domain apps are published under, one subdomain each: apprun.app (localhost in development). */
  apps: string
}

export type Site = { kind: 'builder' } | { kind: 'app'; slug: string } | { kind: 'none' }

/** The hosts the Worker's vars name (wrangler.jsonc; packages/worker/.dev.vars in development), else localhost. */
export function hostsOf(env: { BUILDER_HOST?: string; APP_DOMAIN?: string } | undefined): Hosts {
  return { builder: env?.BUILDER_HOST || 'localhost', apps: env?.APP_DOMAIN || 'localhost' }
}

/**
 * The site a hostname (no port: URL's `hostname`) is for. An app's is one label under the app domain, which could be
 * an app's slug; whether one is published there is for the app store to say.
 */
export function siteOf(hostname: string, hosts: Hosts): Site {
  const host = hostname.toLowerCase()
  if (host === hosts.builder) return { kind: 'builder' }
  const suffix = `.${hosts.apps}`
  if (host.endsWith(suffix)) {
    const slug = host.slice(0, -suffix.length)
    if (/^[a-z0-9-]{1,63}$/.test(slug)) return { kind: 'app', slug }
  }
  return { kind: 'none' }
}

/** A published app's address, as seen from a request to the builder: the same scheme and port, on the app's host. */
export function appUrl(slug: string, builderUrl: string, hosts: Hosts): string {
  const url = new URL(builderUrl)
  return `${url.protocol}//${slug}.${hosts.apps}${url.port ? `:${url.port}` : ''}/`
}

/** Whether the proxy must refuse a hostname as one of this platform's own: the builder, or any app (or their domain). */
export function isPlatformHost(hostname: string, hosts: Hosts): boolean {
  const host = hostname.toLowerCase()
  return host === hosts.builder || host === hosts.apps || host.endsWith(`.${hosts.apps}`)
}
