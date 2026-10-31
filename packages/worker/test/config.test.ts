import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { unstable_readConfig } from 'wrangler'
import { expect, it } from 'vitest'
import { WORKER_DIR } from '../scripts/wrangler'
import { PAGE_HEADERS } from '../src/http'

const config = unstable_readConfig({ config: join(WORKER_DIR, 'wrangler.jsonc') })
const terraform = readFileSync(join(WORKER_DIR, '../../infrastructure/main.tf'), 'utf8')
const viteConfig = readFileSync(join(WORKER_DIR, '../web/vite.config.ts'), 'utf8')

it('is deployed where Terraform puts Access in front of it', () => {
  // The hostname Access protects is <worker name>.<the account's workers.dev subdomain>; renaming the Worker without
  // changing it would leave the new address open.
  const hostname = /variable "hostname" \{[^}]*default\s*=\s*"([^"]+)"/.exec(terraform)?.[1]
  expect(hostname).toBe(`${config.name}.feature-domain.workers.dev`)
  expect(config.workers_dev).toBe(true)
  // Preview URLs are hostnames of their own, which the Access application doesn't cover.
  expect(config.preview_urls).toBe(false)
})

it('answers published apps on the wildcard Terraform points at it, behind Access, and only runs first', () => {
  const appDomain = /variable "app_domain" \{[^}]*default\s*=\s*"([^"]+)"/.exec(terraform)?.[1]
  expect(appDomain).toBe('apprun.app')
  // The route, the wildcard record and the Access application all name the same domain.
  expect(config.routes).toEqual([{ pattern: `*.${appDomain}/*`, zone_name: appDomain }])
  expect(terraform).toContain('name    = "*.${var.app_domain}"')
  expect(terraform).toMatch(/resource "cloudflare_zero_trust_access_application" "apps" \{[^}]*domain\s*=\s*"\*\.\$\{var\.app_domain\}"/)
  // The Worker tells the sites apart by these, so they must be the hosts Access protects.
  const hostname = /variable "hostname" \{[^}]*default\s*=\s*"([^"]+)"/.exec(terraform)?.[1]
  expect(config.vars).toEqual({ BUILDER_HOST: hostname, APP_DOMAIN: appDomain, MAIL_FROM: `sign-in@${appDomain}` })
  // Every request reaches the Worker first, so an app's host never gets the editor's pages from the assets.
  expect(config.assets).toMatchObject({ binding: 'ASSETS', run_worker_first: true })
})

it("leaves https to the Worker's 308: the zone's Always Use HTTPS would answer a POST with a 301 first", () => {
  // Browsers follow a 301 after a POST with a GET and no body, so a sign-in or a new row would turn into a read.
  expect(terraform).not.toContain('always_use_https')
})

it('is at localhost in development, with apps at <slug>.localhost', () => {
  const vars = Object.fromEntries(
    readFileSync(join(WORKER_DIR, '.dev.vars'), 'utf8')
      .split('\n')
      .filter((line) => /^\w+=/.test(line))
      .map((line) => line.split('=') as [string, string]),
  )
  expect(vars).toEqual({ BUILDER_HOST: 'localhost', APP_DOMAIN: 'localhost', AUTH_SECRET: expect.stringMatching(/^development-only-/) })
})

it('sends sign-in codes from MAIL_FROM only, and keeps AUTH_SECRET out of the config', () => {
  expect(config.send_email).toEqual([{ name: 'EMAIL', allowed_sender_addresses: [config.vars.MAIL_FROM] }])
  expect(config.vars).not.toHaveProperty('AUTH_SECRET')
})

it("sets the same security headers on the pages it passes on as public/_headers does on Cloudflare's own", () => {
  const file = readFileSync(join(WORKER_DIR, '../web/public/_headers'), 'utf8')
  const rules = file.slice(file.indexOf('/*\n'))
  const headers = Object.fromEntries(
    rules
      .split('\n')
      .slice(1)
      .filter((line) => /^\s+[\w-]+:/.test(line))
      .map((line) => {
        const at = line.indexOf(':')
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()]
      }),
  )
  expect(headers).toEqual(PAGE_HEADERS)
})

it('is built from the engine source', () => {
  // The Vite environment is named after the Worker. Configured under another name, the Worker would read the engine's
  // built dist/ instead, and a stale one would deploy an old engine.
  // Whitespace aside, so the formatter may lay the config out as it likes.
  const flat = viteConfig.replace(/\s+/g, ' ')
  expect(flat).toContain(` ${config.name}: { resolve: { conditions: ['@feature-domain/source'] } },`)
})
