# Infrastructure

Terraform for the Cloudflare pieces that outlive a deploy, in the project's own Cloudflare account
(`aebbd702f3406a41df3baec338ce6e5a`, workers.dev subdomain `feature-domain`):

- the D1 database `feature-domain` (protected from `terraform destroy`)
- Cloudflare Access in front of `app.feature-domain.workers.dev`: an allow policy for `allowed_emails`, signed in
  with a one-time code by email or a Cloudflare login (team `feature-domain`)

Code is deployed by wrangler, not Terraform: `npm run deploy -w packages/web`.

## Credentials

Kept in `~/.config/feature-domain/cloudflare.env` (mode 600, never committed); `source` it first.

| Variable | What | Used by |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token: Workers Scripts, D1, Access: Apps and Policies, Access: Organizations, Identity Providers, and Groups, Workers R2 Storage (edit); Account Settings (read); this account only | the provider, wrangler |
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

`terraform output d1_database_id` is the id in `packages/worker/wrangler.jsonc`. Local D1 data is stored per database
id, so after it changes `npm run dev` starts from freshly seeded samples.
