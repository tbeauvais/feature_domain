/** The Worker's bindings and vars (wrangler.jsonc; packages/worker/.dev.vars in development). */
export interface Env {
  DB: D1Database
  /** The built web app's static assets: the editor's pages, and app.html for published apps. */
  ASSETS: Fetcher
  /** Where published apps answer, one subdomain each: apprun.app (localhost in development). */
  APP_DOMAIN: string
  /** The builder's hostname: app.feature-domain.workers.dev (localhost in development). */
  BUILDER_HOST: string
}
