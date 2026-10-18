// The Worker's HTTP API (packages/worker/src/app.ts), run in this process over a store of the caller's: unit tests and
// the e2e tests' per-test API use the Worker's real routes. The import path is computed so this package's typecheck
// doesn't follow it into the Worker's source, which is typed for Cloudflare's runtime, not the browser's.

import type { ModelStore } from '@feature-domain/engine'

export interface WorkerApp {
  request(path: string, init?: RequestInit, env?: unknown): Response | Promise<Response>
}

const APP = `${import.meta.dirname}/../../worker/src/app.ts`

/** `upstream` answers the requests its proxy sends to other sites (by default, the real fetch). */
export async function workerApp(store: ModelStore, upstream?: typeof fetch): Promise<WorkerApp> {
  const { createApp } = (await import(/* @vite-ignore */ APP)) as { createApp(store: () => ModelStore, upstream?: typeof fetch): WorkerApp }
  return createApp(() => store, upstream)
}
