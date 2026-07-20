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

if [[ -z "${TF_VAR_cloudflare_zone_id:-}" || "${TF_VAR_cloudflare_zone_id:-}" == REPLACE_* ]]; then
  echo "ERROR: invalid TF_VAR_cloudflare_zone_id" >&2
  exit 1
fi

if [[ -z "${TF_VAR_cloudflare_tunnel_id:-}" || "${TF_VAR_cloudflare_tunnel_id:-}" == REPLACE_* ]]; then
  echo "ERROR: invalid TF_VAR_cloudflare_tunnel_id" >&2
  exit 1
fi

if [[ "${TF_VAR_zc_domain:-}" != "zai.zeaz.dev" ]]; then
  echo "ERROR: TF_VAR_zc_domain must be zai.zeaz.dev" >&2
  exit 1
fi

if [[ "${TF_VAR_zc_api_domain:-}" != "api.zeaz.dev" ]]; then
  echo "ERROR: TF_VAR_zc_api_domain must be api.zeaz.dev" >&2
  exit 1
fi

legacy_address='cloudflare_dns_record.zc["zc_apex"]'
if terraform -chdir="$TF_DIR" state list 2>/dev/null | grep -Fxq "$legacy_address"; then
  echo "ERROR: legacy apex DNS remains in Terraform state: ${legacy_address}" >&2
  echo "Preserve zeaz.dev by removing only the legacy state binding before planning:" >&2
  echo "terraform -chdir=infra/cloudflare state rm '${legacy_address}'" >&2
  exit 1
fi

exec "$@"
