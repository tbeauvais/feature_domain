// An app's Better Auth configuration: its secret, its cookies and the code email. (Signing in through the app host is
// tested with the route.)

import { describe, expect, it } from 'vitest'
import { appSecret, authConfig, MemoryMailer } from '../src/auth/authFor'

const KEY_A = '0123456789abcdef0123456789abcdef'
const KEY_B = 'fedcba9876543210fedcba9876543210'
const PLATFORM = 'platform-secret-for-tests-only-0123456789'

const config = (baseURL: string, mailer = new MemoryMailer()) =>
  authConfig({ db: {} as D1Database, key: KEY_A, secret: 'x'.repeat(64), baseURL, mailer, waitUntil: () => {} })

describe('appSecret', () => {
  it('is 32 bytes of hex, the same each time, and different per app and per platform secret', async () => {
    const a = await appSecret(PLATFORM, KEY_A)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await appSecret(PLATFORM, KEY_A)).toBe(a)
    expect(await appSecret(PLATFORM, KEY_B)).not.toBe(a)
    expect(await appSecret(`${PLATFORM}!`, KEY_A)).not.toBe(a)
  })
})

describe('authConfig', () => {
  it('names __Host- cookies on https, Secure, host-only', () => {
    const { advanced } = config('https://meetup.apprun.app')
    expect(advanced).toMatchObject({ cookiePrefix: '__Host-fd', useSecureCookies: false, defaultCookieAttributes: { secure: true } })
    expect(advanced).not.toHaveProperty('crossSubDomainCookies')
  })

  it('names plain cookies over http (development), since __Host- needs Secure', () => {
    expect(config('http://meetup.localhost:5173').advanced).toMatchObject({ cookiePrefix: 'fd' })
  })

  it("trusts only the app's own origin, and never validates the schema at run time", () => {
    const c = config('https://meetup.apprun.app')
    expect(c.trustedOrigins).toEqual(['https://meetup.apprun.app'])
    expect(c.advanced.database).toEqual({ validateSchema: false })
    expect(c.advanced.ipAddress).toEqual({ ipAddressHeaders: ['cf-connecting-ip'] })
  })

  it('emails the code, and a button whose link carries it after #, never in the subject or the query', async () => {
    const mailer = new MemoryMailer()
    const plugin = config('https://meetup.apprun.app', mailer).plugins[0] as unknown as {
      options: { sendVerificationOTP(data: { email: string; otp: string; type: string }): Promise<void> }
    }
    await plugin.options.sendVerificationOTP({ email: 'ann+x@example.com', otp: '123456', type: 'sign-in' })
    expect(mailer.sent).toEqual([
      {
        to: 'ann+x@example.com',
        subject: 'Your sign-in code',
        text: 'Your code is 123456. Or sign in here: https://meetup.apprun.app/sign-in?email=ann%2Bx%40example.com#code=123456',
      },
    ])
  })
})
