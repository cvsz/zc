#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/cloudflare/cloudflare-api-lib.sh"

ZONE_NAME="${ZONE_NAME:-zeaz.dev}"
ZC_DOMAIN="${ZC_DOMAIN:-zeaz.dev}"

REPORT="${ROOT_DIR}/docs/reports/generated/zc-cloudflare-api-preflight.md"
: >"${REPORT}.tmp"
ENV_OUT="${ROOT_DIR}/.env.cloudflare.zc.generated"

mkdir -p "${ROOT_DIR}/docs/reports/generated"

cf_cost_lock_check
cf_require_tools
cf_require_token

echo "=== zc Cloudflare API preflight ==="

zone_id="${TF_VAR_cloudflare_zone_id:-${CLOUDFLARE_ZONE_ID:-}}"

if [[ -n "$zone_id" && "$zone_id" != REPLACE_* ]]; then
  cf_validate_zone_id "$zone_id"
  echo "Using supplied Cloudflare zone id for ${ZONE_NAME}"

  tmp="$(mktemp)"
  if ! cf_api GET "/zones/${zone_id}" >"$tmp"; then
    rm -f "$tmp"
    cf_fail "token cannot read supplied zone id. Required: Zone/Zone Read on zeaz.dev"
  fi

  zone_name_from_api="$(jq -r '.result.name // empty' "$tmp")"
  rm -f "$tmp"

  if [[ "$zone_name_from_api" != "$ZONE_NAME" ]]; then
    cf_fail "supplied zone id does not match ${ZONE_NAME}; got ${zone_name_from_api:-empty}"
  fi
else
  echo "No zone id supplied; trying zone lookup by name"
  zone_id="$(cf_zone_id_by_name "$ZONE_NAME" || true)"
  [[ -n "$zone_id" ]] || cf_fail "could not resolve zone id for ${ZONE_NAME}; set CLOUDFLARE_ZONE_ID or TF_VAR_cloudflare_zone_id"
  cf_validate_zone_id "$zone_id"
fi

tunnel_name="${CLOUDFLARE_TUNNEL_NAME:-${ZC_TUNNEL_NAME:-zc}}"
account_id="${CLOUDFLARE_ACCOUNT_ID:-${TF_VAR_cloudflare_account_id:-}}"
tunnel_id="${TF_VAR_cloudflare_tunnel_id:-${CLOUDFLARE_TUNNEL_ID:-}}"

[[ "$account_id" =~ ^[a-f0-9]{32}$ ]] ||
  cf_fail "CLOUDFLARE_ACCOUNT_ID must be the real 32-character account ID"

access_team_name="${CLOUDFLARE_ACCESS_TEAM_NAME:-${TF_VAR_cloudflare_access_team_name:-}}"
[[ "$access_team_name" =~ ^[a-z0-9-]+$ ]] ||
  cf_fail "CLOUDFLARE_ACCESS_TEAM_NAME must contain lowercase letters, digits, and hyphens"

allowed_emails="${ZC_ALLOWED_EMAILS_JSON:-${TF_VAR_allowed_emails:-}}"
service_token_ids="${ZC_SERVICE_TOKEN_IDS_JSON:-${TF_VAR_service_token_ids:-}}"
jq -e 'type == "array" and length > 0' <<<"$allowed_emails" >/dev/null ||
  cf_fail "ZC_ALLOWED_EMAILS_JSON must be a non-empty JSON array"
jq -e 'type == "array" and length > 0' <<<"$service_token_ids" >/dev/null ||
  cf_fail "ZC_SERVICE_TOKEN_IDS_JSON must be a non-empty JSON array"

if [[ -z "$tunnel_id" || "$tunnel_id" == REPLACE_* ]]; then
  if [[ -n "$account_id" ]]; then
    echo "Trying Cloudflare API tunnel lookup by name: ${tunnel_name}"
    tunnel_id="$(cf_tunnel_id_by_name "$account_id" "$tunnel_name" || true)"

    if [[ -z "$tunnel_id" ]]; then
      echo "Tunnel name ${tunnel_name} not found; selecting first active/healthy tunnel from account"
      tunnel_id="$(cf_tunnel_id_first_healthy "$account_id" || true)"
    fi

    {
      echo
      echo "## Tunnels visible to token"
      echo
      cf_tunnel_list_report "$account_id" | sed 's/^/- /' || true
    } >>"$REPORT.tmp"
  fi
fi

if [[ -z "$tunnel_id" || "$tunnel_id" == REPLACE_* ]]; then
  if command -v cloudflared >/dev/null 2>&1; then
    echo "Trying local cloudflared tunnel list"
    tunnel_id="$(cloudflared tunnel list 2>/dev/null | awk 'NR>1 && $1 ~ /^[0-9a-fA-F-]{36}$/ {print $1; exit}' || true)"
  fi
fi

[[ -n "$tunnel_id" ]] || cf_fail "could not resolve tunnel UUID; set CLOUDFLARE_TUNNEL_ID, TF_VAR_cloudflare_tunnel_id, or CLOUDFLARE_TUNNEL_NAME"
cf_validate_tunnel_uuid "$tunnel_id"

zc_domain_id="$(cf_dns_record_id "$zone_id" "$ZC_DOMAIN" || true)"
access_apps_json="$(cf_api GET "/accounts/${account_id}/access/apps" || true)"
access_app_id="$(jq -r --arg domain "$ZC_DOMAIN" '
  (.result // [])
  | map(select((.domain // "") == $domain))
  | .[0].id // empty
' <<<"$access_apps_json")"

access_policies_json="$(cf_api GET "/accounts/${account_id}/access/policies" || true)"
users_policy_id="$(jq -r '
  (.result // [])
  | map(select((.name // "") == "zc explicit users"))
  | .[0].id // empty
' <<<"$access_policies_json")"
cli_policy_id="$(jq -r '
  (.result // [])
  | map(select((.name // "") == "zc explicit CLI services"))
  | .[0].id // empty
' <<<"$access_policies_json")"

{
  echo "# zc Cloudflare API Preflight"
  echo
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "- zone_name: ${ZONE_NAME}"
  echo "- zone_id: ${zone_id}"
  echo "- account_id: ${account_id}"
  echo "- tunnel_name: ${tunnel_name}"
  echo "- tunnel_id: ${tunnel_id}"
  echo "- tunnel_target: ${tunnel_id}.cfargotunnel.com"
  echo
  echo "## DNS records"
  echo
  echo "- ${ZC_DOMAIN}: ${zc_domain_id:-MISSING}"
  echo "- Access application: ${access_app_id:-MISSING}"
  echo "- User policy: ${users_policy_id:-MISSING}"
  echo "- CLI service policy: ${cli_policy_id:-MISSING}"
  echo
  echo "## Terraform import commands"
  echo "terraform import cloudflare_zero_trust_tunnel_cloudflared.zc '${account_id}/${tunnel_id}'"
  echo "terraform import cloudflare_zero_trust_tunnel_cloudflared_config.zc '${account_id}/${tunnel_id}'"
  [[ -n "$access_app_id" ]] && echo "terraform import cloudflare_zero_trust_access_application.zc 'accounts/${account_id}/${access_app_id}'"
  [[ -n "$users_policy_id" ]] && echo "terraform import cloudflare_zero_trust_access_policy.users '${account_id}/${users_policy_id}'"
  [[ -n "$cli_policy_id" ]] && echo "terraform import cloudflare_zero_trust_access_policy.cli_services '${account_id}/${cli_policy_id}'"
  [[ -n "$zc_domain_id" ]] && echo "terraform import cloudflare_dns_record.zc '${zone_id}/${zc_domain_id}'"
  cat "${REPORT}.tmp" 2>/dev/null || true
} >"$REPORT"
rm -f "${REPORT}.tmp"

cat >"$ENV_OUT" <<EOF_ENV
# Generated by zc-cloudflare-preflight.sh
# Local-only. Do not commit.
COST_LOCK=true
CLOUDFLARE_PLAN_TIER=Free
ALLOW_PAID_CLOUDFLARE_FEATURES=false
ALLOW_LOAD_BALANCING=false
ALLOW_ADVANCED_WAF=false
ALLOW_LOGPUSH=false
ALLOW_R2_WRITE=false
ALLOW_WORKERS_DEPLOY=false

TF_VAR_cloudflare_account_id=${account_id}
TF_VAR_cloudflare_zone_id=${zone_id}
TF_VAR_cloudflare_tunnel_name=${tunnel_name}
TF_VAR_cloudflare_access_team_name=${access_team_name}
TF_VAR_zc_domain=${ZC_DOMAIN}
TF_VAR_allowed_emails='${allowed_emails}'
TF_VAR_service_token_ids='${service_token_ids}'
ZC_IMPORT_TUNNEL_ID=${tunnel_id}
ZC_IMPORT_ACCESS_APP_ID=${access_app_id}
ZC_IMPORT_USERS_POLICY_ID=${users_policy_id}
ZC_IMPORT_CLI_POLICY_ID=${cli_policy_id}
ZC_IMPORT_DNS_RECORD_ID=${zc_domain_id}
EOF_ENV

chmod 600 "$ENV_OUT"

echo "PASS: Cloudflare preflight complete"
echo "Report: $REPORT"
echo "Env: $ENV_OUT"
