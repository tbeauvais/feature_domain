// The Worker's HTTP API (packages/worker/src/app.ts), run in this process over a store of the caller's: unit tests and
// the e2e tests' per-test API use the Worker's real routes. The import path is computed so this package's typecheck
// doesn't follow it into the Worker's source, which is typed for Cloudflare's runtime, not the browser's.

import { MemoryRowStore, type RowStore, type ServerModelStore } from '@feature-domain/engine'

export interface WorkerApp {
  request(path: string, init?: RequestInit, env?: unknown): Response | Promise<Response>
}

const APP = `${import.meta.dirname}/../../worker/src/app.ts`
const APPS = `${import.meta.dirname}/../../worker/src/apps.ts`

/**
 * `upstream` answers the requests its proxy sends to other sites (by default, the real fetch); `rows` keeps Database
 * tables' rows (by default, a fresh one in memory, beside the caller's model store), and published apps are kept in
 * memory too. The builder is at localhost, and apps at <slug>.localhost.
 */
export async function workerApp(store: ServerModelStore, upstream?: typeof fetch, rows: RowStore = new MemoryRowStore()): Promise<WorkerApp> {
  const { createApp } = (await import(/* @vite-ignore */ APP)) as {
    createApp(options: { store: () => ServerModelStore; upstream?: typeof fetch; rows: () => RowStore; apps: () => unknown }): WorkerApp
  }
  const { MemoryAppStore } = (await import(/* @vite-ignore */ APPS)) as { MemoryAppStore: new (now?: () => number) => unknown }
  const apps = new MemoryAppStore()
  return createApp({ store: () => store, upstream, rows: () => rows, apps: () => apps })
}
