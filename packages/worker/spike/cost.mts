// Where the first request's time goes: a new instance's setup vs a request on an instance already set up (spike).
import { DatabaseSync } from 'node:sqlite'
import { betterAuth } from 'better-auth'
import { emailOTP } from 'better-auth/plugins/email-otp'
const db = {
  prepare() {
    throw new Error('no db')
  },
  batch() {
    throw new Error('no db')
  },
  exec() {
    throw new Error('no db')
  },
}
const make = () =>
  betterAuth({
    database: new DatabaseSync(':memory:'),
    secret: '9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0',
    baseURL: 'http://x.localhost',
    basePath: '/api/v1/app/auth',
    telemetry: { enabled: false },
    advanced: { database: { validateSchema: false } },
    plugins: [emailOTP({ sendVerificationOTP: async () => {} })],
  })
const req = () => new Request('http://x.localhost/api/v1/app/auth/get-session')
const time = async (label: string, n: number, f: () => Promise<unknown>) => {
  await f()
  const s = performance.now()
  for (let i = 0; i < n; i++) await f()
  console.log(label, ((performance.now() - s) / n).toFixed(3), 'ms')
}
await time('new instance + request', 100, () => make().handler(req()))
const one = make()
await time('same instance, request ', 500, () => one.handler(req()))
await time('new instance + $context', 100, () => make().$context)
void db
