/** The Worker's bindings and vars (wrangler.jsonc; packages/worker/.dev.vars in development). */
export interface Env {
  DB: D1Database
  /** The built web app's static assets: the editor's pages, and app.html for published apps. */
  ASSETS: Fetcher
  /** Where published apps answer, one subdomain each: apprun.app (localhost in development). */
  APP_DOMAIN: string
  /** The builder's hostname: app.feature-domain.workers.dev (localhost in development). */
  BUILDER_HOST: string
  /** The platform's secret, from which each app's Better Auth secret is derived (a Worker secret; spike: optional). */
  AUTH_SECRET?: string
}

declare global {
  interface ImportMeta {
    /** Vite's hot module API: set only by Vite's development server (builds replace it with undefined, in any mode). */
    readonly hot?: unknown
  }
}
