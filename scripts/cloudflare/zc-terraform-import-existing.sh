#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.cloudflare.zc.generated"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[[ "${APPLY:-false}" == "true" ]] ||
  fail "Terraform state mutation requires APPLY=true"
[[ "${CONFIRM_TERRAFORM_IMPORT:-no}" == "yes" ]] ||
  fail "Terraform state mutation requires CONFIRM_TERRAFORM_IMPORT=yes"
[[ -f "$ENV_FILE" ]] ||
  fail "missing $ENV_FILE; run zc-cloudflare-preflight.sh first"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

account_id="${TF_VAR_cloudflare_account_id:-}"
zone_id="${TF_VAR_cloudflare_zone_id:-}"
tunnel_id="${ZC_IMPORT_TUNNEL_ID:-}"

[[ "$account_id" =~ ^[a-f0-9]{32}$ ]] || fail "invalid Cloudflare account ID"
[[ "$zone_id" =~ ^[a-f0-9]{32}$ ]] || fail "invalid Cloudflare zone ID"
[[ "$tunnel_id" =~ ^[0-9a-fA-F-]{36}$ ]] || fail "invalid Cloudflare tunnel ID"

cd "${ROOT_DIR}/infra/cloudflare"

terraform import \
  cloudflare_zero_trust_tunnel_cloudflared.zc \
  "${account_id}/${tunnel_id}"
terraform import \
  cloudflare_zero_trust_tunnel_cloudflared_config.zc \
  "${account_id}/${tunnel_id}"

if [[ -n "${ZC_IMPORT_ACCESS_APP_ID:-}" ]]; then
  terraform import \
    cloudflare_zero_trust_access_application.zc \
    "accounts/${account_id}/${ZC_IMPORT_ACCESS_APP_ID}"
fi
if [[ -n "${ZC_IMPORT_USERS_POLICY_ID:-}" ]]; then
  terraform import \
    cloudflare_zero_trust_access_policy.users \
    "${account_id}/${ZC_IMPORT_USERS_POLICY_ID}"
fi
if [[ -n "${ZC_IMPORT_CLI_POLICY_ID:-}" ]]; then
  terraform import \
    cloudflare_zero_trust_access_policy.cli_services \
    "${account_id}/${ZC_IMPORT_CLI_POLICY_ID}"
fi
if [[ -n "${ZC_IMPORT_DNS_RECORD_ID:-}" ]]; then
  terraform import \
    cloudflare_dns_record.zc \
    "${zone_id}/${ZC_IMPORT_DNS_RECORD_ID}"
fi

echo "Import complete. Run terraform plan and review all proposed changes."
