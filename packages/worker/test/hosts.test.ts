import { describe, expect, it } from 'vitest'
import { appUrl, hostsOf, isPlatformHost, siteOf } from '../src/hosts'
import { localD1 } from './localD1'

const DEPLOYED = { builder: 'app.feature-domain.workers.dev', apps: 'apprun.app' }
const LOCAL = { builder: 'localhost', apps: 'localhost' }

describe('siteOf', () => {
  it("finds the builder only at its own host, and an app one label under the apps' domain", () => {
    expect(siteOf('app.feature-domain.workers.dev', DEPLOYED)).toEqual({ kind: 'builder' })
    expect(siteOf('requests.apprun.app', DEPLOYED)).toEqual({ kind: 'app', slug: 'requests' })
    expect(siteOf('Requests.AppRun.app', DEPLOYED)).toEqual({ kind: 'app', slug: 'requests' })
    expect(siteOf('localhost', LOCAL)).toEqual({ kind: 'builder' })
    expect(siteOf('team-requests.localhost', LOCAL)).toEqual({ kind: 'app', slug: 'team-requests' })
  })

  it("answers nothing for any other host, so the builder is never served on an app's address", () => {
    for (const host of [
      'apprun.app',
      'a.b.apprun.app',
      'x_y.apprun.app',
      'evilapprun.app',
      'other.workers.dev',
      'feature-domain.workers.dev',
      'localhost',
      `${'a'.repeat(64)}.apprun.app`,
    ])
      expect(siteOf(host, DEPLOYED), host).toEqual({ kind: 'none' })
  })
})

it("makes an app's address from the builder's scheme and port", () => {
  expect(appUrl('requests', 'https://app.feature-domain.workers.dev/api/v1/models/7/publish', DEPLOYED)).toBe('https://requests.apprun.app/')
  expect(appUrl('requests', 'http://localhost:5173/api/v1/models/7/publish', LOCAL)).toBe('http://requests.localhost:5173/')
})

it("counts the builder, the apps' domain and every app as the platform's own", () => {
  for (const host of ['app.feature-domain.workers.dev', 'apprun.app', 'requests.apprun.app', 'a.b.apprun.app'])
    expect(isPlatformHost(host, DEPLOYED), host).toBe(true)
  for (const host of ['example.com', 'apprun.app.example.com', 'myapprun.app', 'feature-domain.workers.dev'])
    expect(isPlatformHost(host, DEPLOYED), host).toBe(false)
})

it("reads the hosts from the Worker's vars, which development sets to localhost", async () => {
  expect(hostsOf({ BUILDER_HOST: 'b.example', APP_DOMAIN: 'apps.example' })).toEqual({ builder: 'b.example', apps: 'apps.example' })
  expect(hostsOf(undefined)).toEqual(LOCAL)
  const d1 = await localD1({ migrate: false })
  try {
    expect(hostsOf(d1.env)).toEqual(LOCAL)
    expect(d1.env.BUILDER_HOST).toBe('localhost')
  } finally {
    await d1.dispose()
  }
})
