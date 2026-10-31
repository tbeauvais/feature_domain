# The Cloudflare pieces that outlive any one deploy: the D1 database and the Access gate in front of the editor.
# Code is not deployed from here: `npm run deploy` (wrangler) applies migrations and uploads the Worker and the web
# build, from the same config `vite dev` uses, so local and Cloudflare stay the same. See README.md.
#
# Auth: CLOUDFLARE_API_TOKEN for the provider and an R2 key (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) for the
# backend; README.md lists the token's permissions. Neither is ever committed.

terraform {
  required_version = ">= 1.10"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.23"
    }
  }

  # State lives in R2 (Cloudflare's S3-compatible storage) in this project's own account. The bucket was created once
  # by hand (`wrangler r2 bucket create feature-domain-terraform-state`): Terraform can't create the bucket holding its
  # own state.
  backend "s3" {
    bucket = "feature-domain-terraform-state"
    key    = "feature-domain/terraform.tfstate"
    region = "auto"
    endpoints = {
      s3 = "https://aebbd702f3406a41df3baec338ce6e5a.r2.cloudflarestorage.com"
    }
    # R2 is not AWS: skip the AWS-only checks, and use path-style addresses.
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
    use_path_style              = true
    # A lock file beside the state (conditional writes, which R2 supports), so two applies can't run at once.
    use_lockfile = true
  }
}

provider "cloudflare" {}

variable "account_id" {
  description = "The Feature Domain Cloudflare account (not the stack project's)"
  type        = string
  default     = "aebbd702f3406a41df3baec338ce6e5a"
}

variable "hostname" {
  description = "Where the Worker answers: <worker name in wrangler.jsonc>.<the account's workers.dev subdomain>"
  type        = string
  default     = "app.feature-domain.workers.dev"
}

variable "app_domain" {
  description = "Where published apps answer, one subdomain each (<slug>.<app_domain>): a zone in this account, registered with Cloudflare Registrar. The Worker's APP_DOMAIN var"
  type        = string
  default     = "apprun.app"
}

variable "allowed_emails" {
  # No default: the list is personal data and the repo is public. Set TF_VAR_allowed_emails (a JSON list) in
  # ~/.config/feature-domain/cloudflare.env.
  description = "Who may open the editor (with a one-time code by email, or their Cloudflare login); there are no platform accounts yet."
  type        = list(string)

  validation {
    condition     = length(var.allowed_emails) > 0
    error_message = "At least one email is required: an empty allow list locks everyone out."
  }
}

variable "session_duration" {
  description = "How long an Access sign-in lasts"
  type        = string
  default     = "168h"
}

# ── Storage ──────────────────────────────────────────────────────────────────
# The one D1 database: models now, app data (RowStore) later. Its id goes in packages/worker/wrangler.jsonc.
resource "cloudflare_d1_database" "main" {
  account_id = var.account_id
  name       = "feature-domain"

  read_replication = {
    mode = "disabled"
  }

  # Destroying it deletes every model. Remove this block deliberately before Terraform may ever do that.
  lifecycle {
    prevent_destroy = true
  }
}

# ── Access ───────────────────────────────────────────────────────────────────
# Cloudflare Access protects the whole hostname, the editor and /api alike, until platform accounts exist. Editors sign
# in at the team's page (feature-domain.cloudflareaccess.com) with a one-time code by email, or with their Cloudflare
# login, which Access always offers. The application lists no identity providers, so it offers both.
resource "cloudflare_zero_trust_access_identity_provider" "one_time_pin" {
  account_id = var.account_id
  name       = "One-time PIN"
  type       = "onetimepin"
  config     = {}
}

resource "cloudflare_zero_trust_access_policy" "editors" {
  account_id = var.account_id
  name       = "Feature Domain: allow editors"
  decision   = "allow"

  # Also set on the application: a policy's own session duration wins over the application's, and unset it defaults
  # to 24h.
  session_duration = var.session_duration

  include = [
    for email in var.allowed_emails : {
      email = {
        email = email
      }
    }
  ]

  # Without it the editor and /api are open to anyone, and deploying never brings it back. Remove this block
  # deliberately before Terraform may ever delete it.
  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_zero_trust_access_application" "editor" {
  account_id       = var.account_id
  name             = "Feature Domain editor"
  domain           = var.hostname
  type             = "self_hosted"
  session_duration = var.session_duration
  # The session cookie goes with navigation to the site, but never with requests other sites' pages make (such as a
  # form posting to /api), whatever a browser's own default.
  same_site_cookie_attribute = "lax"

  policies = [
    {
      id         = cloudflare_zero_trust_access_policy.editors.id
      precedence = 1
    }
  ]

  # Without it the editor and /api are open to anyone, and deploying never brings it back. Remove this block
  # deliberately before Terraform may ever delete it.
  lifecycle {
    prevent_destroy = true
  }
}

# ── Published apps ───────────────────────────────────────────────────────────
# Each published app answers at <slug>.<app_domain>, served by the same Worker as the editor: a route on the
# wildcard in packages/worker/wrangler.jsonc, whose APP_DOMAIN var names this domain (the Worker picks the site by
# host). Its own subdomain keeps every app on an origin of its own.
data "cloudflare_zone" "apps" {
  filter = {
    name = var.app_domain
    account = {
      id = var.account_id
    }
  }
}

# A Workers route only runs for proxied hostnames, and Custom Domains don't take wildcards, so the wildcard needs a
# DNS record. 100:: is the discard prefix: the Worker answers before any origin would be asked. The apex has no
# record, so it serves nothing.
resource "cloudflare_dns_record" "apps_wildcard" {
  zone_id = data.cloudflare_zone.apps.zone_id
  name    = "*.${var.app_domain}"
  type    = "AAAA"
  content = "100::"
  proxied = true
  ttl     = 1
  comment = "Published apps: the Worker app answers on its *.${var.app_domain} route"
}

# Apps are https only: Cloudflare sends plain http to https before the Worker sees it (the Worker redirects too, and
# sends HSTS), so a session cookie is never set over http.
resource "cloudflare_zone_setting" "apps_always_use_https" {
  zone_id    = data.cloudflare_zone.apps.zone_id
  setting_id = "always_use_https"
  value      = "on"
}

# Published apps sit behind the same allow list as the editor until apps have sign-in of their own: their forms
# write rows, and nothing yet limits who may.
resource "cloudflare_zero_trust_access_application" "apps" {
  account_id                 = var.account_id
  name                       = "Feature Domain published apps"
  domain                     = "*.${var.app_domain}"
  type                       = "self_hosted"
  session_duration           = var.session_duration
  same_site_cookie_attribute = "lax"

  policies = [
    {
      id         = cloudflare_zero_trust_access_policy.editors.id
      precedence = 1
    }
  ]

  # Without it every published app is open to anyone, and deploying never brings it back. Remove this block
  # deliberately before Terraform may ever delete it.
  lifecycle {
    prevent_destroy = true
  }
}

output "d1_database_id" {
  description = "Put this in packages/worker/wrangler.jsonc (d1_databases[0].database_id)"
  value       = cloudflare_d1_database.main.id
}

output "url" {
  description = "The editor"
  value       = "https://${var.hostname}"
}
