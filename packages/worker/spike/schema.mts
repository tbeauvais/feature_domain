// Prints the SQL Better Auth would create for one app's prefixed tables (spike).
import { DatabaseSync } from 'node:sqlite'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { getMigrations } from 'better-auth/db/migration'

const p = 'app_0123456789abcdef0123456789abcdef_'
const options = {
  database: new DatabaseSync(':memory:'),
  secret: 'x'.repeat(32),
  user: { modelName: `${p}user` },
  session: { modelName: `${p}session` },
  account: { modelName: `${p}account` },
  verification: { modelName: `${p}verification` },
  rateLimit: { enabled: true, storage: 'database' as const, modelName: `${p}rate_limit` },
  plugins: [emailOTP({ sendVerificationOTP: async () => {} })],
  telemetry: { enabled: false },
}
const { compileMigrations, toBeCreated } = await getMigrations(options)
console.log(toBeCreated.map((t) => t.table))
console.log(await compileMigrations())
