#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.cloudflare.zc.generated"
TF_DIR="${ROOT_DIR}/infra/cloudflare"

if grep -RIn "REPLACE_WITH_ZEAZ_DEV_ZONE_ID\|REPLACE_WITH_TUNNEL_UUID\|REPLACE_WITH_REAL_ZONE_ID\|REPLACE_WITH_REAL_TUNNEL_UUID" \
  "${TF_DIR}" \
  --include='*.tfvars' \
  --include='*.auto.tfvars' \
  --include='terraform.tfvars' >/tmp/zc-placeholder-tfvars.log 2>/dev/null; then
  cat /tmp/zc-placeholder-tfvars.log >&2
  echo "ERROR: placeholder values found in Terraform auto-loaded tfvars. Remove or replace them." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: missing ${ENV_FILE}; run make cf-zc-preflight first" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

for name in \
  TF_VAR_cloudflare_account_id \
  TF_VAR_cloudflare_zone_id \
  TF_VAR_cloudflare_access_team_name \
  TF_VAR_allowed_emails \
  TF_VAR_service_token_ids; do
  if [[ -z "${!name:-}" || "${!name:-}" == *REPLACE_* ]]; then
    echo "ERROR: invalid ${name}" >&2
    exit 1
  fi
done

if [[ "${TF_VAR_zc_domain:-}" != "zeaz.dev" ]]; then
  echo "ERROR: TF_VAR_zc_domain must be zeaz.dev" >&2
  exit 1
fi

jq -e 'type == "array" and length > 0 and all(.[]; type == "string" and length > 0)' \
  <<<"${TF_VAR_allowed_emails:-}" >/dev/null || {
  echo "ERROR: TF_VAR_allowed_emails must be a non-empty JSON string array" >&2
  exit 1
}

jq -e 'type == "array" and length > 0 and all(.[]; type == "string" and length > 0)' \
  <<<"${TF_VAR_service_token_ids:-}" >/dev/null || {
  echo "ERROR: TF_VAR_service_token_ids must be a non-empty JSON string array" >&2
  exit 1
}

for retired_address in \
  'cloudflare_dns_record.zc["zc_apex"]' \
  'cloudflare_dns_record.zc["zc_app"]' \
  'cloudflare_dns_record.zc["zc_api"]'; do
  if terraform -chdir="$TF_DIR" state list 2>/dev/null | grep -Fxq "$retired_address"; then
    echo "ERROR: retired dual-host DNS remains in Terraform state: ${retired_address}" >&2
    echo "Review and remove the retired state binding before planning the zeaz.dev apex migration." >&2
    exit 1
  fi
done

exec "$@"
