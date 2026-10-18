# The Cloudflare pieces that outlive any one deploy: the D1 database and the Access gate in front of the editor.
# Code is not deployed from here: `npm run deploy` (wrangler) applies migrations and uploads the Worker and the web
# build, from the same config `vite dev` uses, so local and Cloudflare stay the same. See README.md.
#
# Auth: CLOUDFLARE_API_TOKEN (Workers Scripts, D1, Access: Apps and Policies, Workers R2 Storage, Account Settings
# read) for the provider; AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (an R2 key for the state bucket) for the backend.
# Neither is ever committed.

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
}

resource "cloudflare_zero_trust_access_application" "editor" {
  account_id       = var.account_id
  name             = "Feature Domain editor"
  domain           = var.hostname
  type             = "self_hosted"
  session_duration = var.session_duration

  policies = [
    {
      id         = cloudflare_zero_trust_access_policy.editors.id
      precedence = 1
    }
  ]
}

output "d1_database_id" {
  description = "Put this in packages/worker/wrangler.jsonc (d1_databases[0].database_id)"
  value       = cloudflare_d1_database.main.id
}

output "url" {
  description = "The editor"
  value       = "https://${var.hostname}"
}
