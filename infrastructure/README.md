# Infrastructure

Terraform for the Cloudflare pieces that outlive a deploy, in the project's own Cloudflare account
(`aebbd702f3406a41df3baec338ce6e5a`, workers.dev subdomain `feature-domain`):

- the D1 database `feature-domain` (protected from `terraform destroy`)
- Cloudflare Access in front of `app.feature-domain.workers.dev`: an allow policy for `allowed_emails`, signed in
  with a one-time code by email or a Cloudflare login (team `feature-domain`)
- published apps on `apprun.app` (registered with Cloudflare Registrar, so its zone is in this account): a proxied
  wildcard DNS record, `*.apprun.app`, for the Worker's route, and Access on `*.apprun.app` with the same allow policy
  (protected from destroy, like the editor's). The apex has no record and serves nothing

Code is deployed by wrangler, not Terraform: `npm run deploy -w packages/web`.

## Credentials

Kept in `~/.config/feature-domain/cloudflare.env` (mode 600, never committed); `source` it first.

| Variable | What | Used by |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token: Workers Scripts, D1, Access: Apps and Policies, Access: Organizations, Identity Providers, and Groups, Workers R2 Storage (edit); Account Settings (read); this account only. Zone: Zone (read), DNS (edit), Workers Routes (edit); the `apprun.app` zone only | the provider, wrangler |
| `CLOUDFLARE_ACCOUNT_ID` | the account above | wrangler |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | R2 key, Object Read & Write on `feature-domain-terraform-state` only | the state backend |
| `TF_VAR_allowed_emails` | who may sign in, as a JSON list (`'["you@example.com"]'`); kept out of the public repo | the Access policy |

## Changing infrastructure

```bash
source ~/.config/feature-domain/cloudflare.env
cd infrastructure
terraform init
terraform plan
terraform apply
```

State is in R2 (`feature-domain-terraform-state`, created once with `wrangler r2 bucket create`), locked while an
apply runs.

## Deploying

```bash
source ~/.config/feature-domain/cloudflare.env
npm run deploy -w packages/web   # build, migrate and seed D1 (--remote), wrangler deploy
```

Migrations run before the new code is uploaded, and nothing rolls them back if the upload fails, so every migration
must keep working with the Worker already running: add tables and columns; drop or rename only in a later deploy, once
no running code uses them. wrangler asks before applying migrations to Cloudflare.

## Published apps' sign-in

Apps with sign-in (Data Apps iteration 3) need two things set up once, by hand, before the deploy that brings it:

1. **The platform's secret**, from which each app's sign-in secret is derived. Never in the repo or `wrangler.jsonc`:

   ```bash
   source ~/.config/feature-domain/cloudflare.env
   cd packages/worker && openssl rand -hex 32 | node_modules/.bin/wrangler secret put AUTH_SECRET   # the Worker in wrangler.jsonc
   ```

   Changing it signs everyone out of every app (their session cookies no longer verify); accounts are kept.

2. **Email Sending for `apprun.app`**: in the dashboard, Compute > Email Service > Email Sending, onboard
   `apprun.app` (its DNS is on Cloudflare). This adds the SPF, DKIM, DMARC and bounce records. Codes come from
   `MAIL_FROM` (`sign-in@apprun.app`, a var in `packages/worker/wrangler.jsonc`) under each app's name, through the
   Worker's `EMAIL` binding, which may send only from that address. Email Sending is in public beta and needs Workers
   Paid.

Without the secret an app's sign-in answers 503; without the binding, asking for a code does.

After a deploy that adds an auth schema step (`packages/worker/src/auth/tables.ts`), run
`npm run db:upgrade-apps -w packages/worker -- --remote`. Apps not upgraded yet keep working (steps only add), and each
is brought up to date the next time someone signs in to it.

`terraform output d1_database_id` is the id in `packages/worker/wrangler.jsonc`. Local D1 data is stored per database
id, so after it changes `npm run dev` starts from freshly seeded samples.
