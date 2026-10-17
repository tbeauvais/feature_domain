// Runs the wrangler this package installs (the version the Vite plugin uses), never one npx would find or download.

import { execFileSync, type ExecFileSyncOptions } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

export const WORKER_DIR = join(import.meta.dirname, '..')

const bin = join(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), 'bin', 'wrangler.js')

export function wrangler(args: string[], options: ExecFileSyncOptions = {}) {
  return execFileSync(process.execPath, [bin, ...args], { cwd: WORKER_DIR, ...options })
}

/** `args` aimed at the local database, unless they ask for Cloudflare's (`--remote`). */
export const localUnlessRemote = (args: string[]) => (args.includes('--remote') ? args : ['--local', ...args])
