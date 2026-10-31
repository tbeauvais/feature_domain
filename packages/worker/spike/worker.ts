// Spike: Better Auth for one app in workerd, without nodejs_compat. GET /mail shows the last code sent.
import { appSecret, authFor, MemoryMailer } from '../src/auth/authFor'
import { D1AuthTables } from '../src/auth/store'

const mailer = new MemoryMailer()

export default {
  async fetch(request: Request, env: { DB: D1Database }, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/mail') return Response.json(mailer.sent.at(-1) ?? null)
    const { key } = await new D1AuthTables(env.DB).ensure('spike-model')
    const auth = authFor({
      db: env.DB,
      key,
      secret: await appSecret('spike-platform-secret-0123456789abcdef', key),
      baseURL: url.origin,
      mailer,
      waitUntil: (p) => ctx.waitUntil(p),
    })
    return auth.handler(request)
  },
}
