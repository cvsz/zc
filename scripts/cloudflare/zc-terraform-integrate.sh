#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TF_DIR="${ROOT_DIR}/infra/cloudflare"

mkdir -p "$TF_DIR" "${ROOT_DIR}/docs/reports/generated"

# Remove legacy monolithic config to prevent duplicate provider/variable/local/resource declarations.
rm -f "${TF_DIR}/zc_edge.tf"

cat > "${TF_DIR}/versions.tf" <<'TF'
terraform {
  required_version = ">= 1.5.0"

  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
    }
  }
}
TF

cat > "${TF_DIR}/variables.tf" <<'TF'
variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for zeaz.dev"
  type        = string

  validation {
    condition     = can(regex("^[a-f0-9]{32}$", var.cloudflare_zone_id))
    error_message = "cloudflare_zone_id must be the real 32-character Cloudflare zone ID, not a placeholder."
  }
}

variable "cloudflare_tunnel_id" {
  description = "Cloudflare Tunnel UUID for zeaz.dev"
  type        = string

  validation {
    condition     = can(regex("^[0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{12}$", var.cloudflare_tunnel_id))
    error_message = "cloudflare_tunnel_id must be the real Cloudflare Tunnel UUID, not a placeholder."
  }
}

variable "zc_domain" {
  description = "Canonical zc web application hostname"
  type        = string
  default     = "zai.zeaz.dev"

  validation {
    condition     = var.zc_domain == "zai.zeaz.dev"
    error_message = "zc_domain must remain zai.zeaz.dev."
  }
}

variable "zc_api_domain" {
  description = "Canonical zc Enterprise API hostname"
  type        = string
  default     = "api.zeaz.dev"

  validation {
    condition     = var.zc_api_domain == "api.zeaz.dev"
    error_message = "zc_api_domain must remain api.zeaz.dev."
  }
}
TF

cat > "${TF_DIR}/main.tf" <<'TF'
locals {
  tunnel_target = "${var.cloudflare_tunnel_id}.cfargotunnel.com"

  zc_dns_records = {
    zc_app = {
      name    = var.zc_domain
      type    = "CNAME"
      content = local.tunnel_target
      proxied = true
      comment = "zc via Cloudflare Tunnel"
    }
    zc_api = {
      name    = var.zc_api_domain
      type    = "CNAME"
      content = local.tunnel_target
      proxied = true
      comment = "zc Enterprise API via Cloudflare Tunnel"
    }
  }
}

resource "cloudflare_dns_record" "zc" {
  for_each = local.zc_dns_records

  zone_id = var.cloudflare_zone_id
  name    = each.value.name
  type    = each.value.type
  content = each.value.content
  proxied = each.value.proxied
  ttl     = 1
  comment = each.value.comment
}
TF

cat > "${TF_DIR}/outputs.tf" <<'TF'
output "zc_dns_records" {
  description = "zc DNS records managed by Terraform"
  value = {
    for key, record in cloudflare_dns_record.zc :
    key => {
      id      = record.id
      name    = record.name
      type    = record.type
      content = record.content
      proxied = record.proxied
    }
  }
}
TF

cat > "${TF_DIR}/terraform.tfvars.example" <<'TF'
cloudflare_zone_id   = "REPLACE_WITH_REAL_ZONE_ID"
cloudflare_tunnel_id = "REPLACE_WITH_REAL_TUNNEL_UUID"

zc_domain     = "zai.zeaz.dev"
zc_api_domain = "api.zeaz.dev"
TF

cat > "${TF_DIR}/README.md" <<'MD'
# zc Cloudflare Terraform

Terraform-managed DNS for the zc full-stack.

Managed hostnames:

- `zai.zeaz.dev` — zc web application
- `api.zeaz.dev` — zc Enterprise API

Rules:

- Use scoped `CLOUDFLARE_API_TOKEN`.
- Do not use Global API Key.
- Do not commit `.env`, `.env.cloudflare`, `.tfvars`, `.terraform/`, or Terraform state.
- Import existing DNS records before apply.
- Apply requires explicit Makefile guards.
MD

cat > "${ROOT_DIR}/docs/reports/generated/zc-terraform-integration.md" <<MD
# zc Terraform Integration

Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)

- Terraform path: \`infra/cloudflare\`
- App path: \`apps/zc\`
- Web hostname: \`zai.zeaz.dev\`
- API hostname: \`api.zeaz.dev\`

No Cloudflare changes were made by this script.
MD

echo "PASS: zc Terraform files generated under ${TF_DIR}"
