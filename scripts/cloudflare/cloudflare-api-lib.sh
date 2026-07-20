#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

CF_API_BASE="${CF_API_BASE:-https://api.cloudflare.com/client/v4}"

cf_fail() { echo "ERROR: $*" >&2; exit 1; }
cf_need() { command -v "$1" >/dev/null 2>&1 || cf_fail "missing command: $1"; }

cf_require_tools() {
  cf_need curl
  cf_need jq
}
cf_require_token() {
  [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] || cf_fail "missing CLOUDFLARE_API_TOKEN"

  for forbidden in CLOUDFLARE_API_KEY CF_API_KEY GLOBAL_API_KEY X_AUTH_KEY CF_GLOBAL_KEY; do
    [[ -z "${!forbidden:-}" ]] || cf_fail "refusing global API key variable: ${forbidden}; use scoped CLOUDFLARE_API_TOKEN only"
  done
}

cf_cost_lock_check() {
  [[ "${COST_LOCK:-true}" == "true" ]] || cf_fail "COST_LOCK must be true"
  [[ "${CLOUDFLARE_PLAN_TIER:-Free}" == "Free" ]] || cf_fail "CLOUDFLARE_PLAN_TIER must be Free"
  [[ "${ALLOW_PAID_CLOUDFLARE_FEATURES:-false}" == "false" ]] || cf_fail "ALLOW_PAID_CLOUDFLARE_FEATURES must be false"
  [[ "${ALLOW_LOAD_BALANCING:-false}" == "false" ]] || cf_fail "ALLOW_LOAD_BALANCING must be false"
  [[ "${ALLOW_ADVANCED_WAF:-false}" == "false" ]] || cf_fail "ALLOW_ADVANCED_WAF must be false"
  [[ "${ALLOW_LOGPUSH:-false}" == "false" ]] || cf_fail "ALLOW_LOGPUSH must be false"
  [[ "${ALLOW_R2_WRITE:-false}" == "false" ]] || cf_fail "ALLOW_R2_WRITE must be false"
  [[ "${ALLOW_WORKERS_DEPLOY:-false}" == "false" ]] || cf_fail "ALLOW_WORKERS_DEPLOY must be false"
}

cf_api() {
  local method="$1"
  local path="$2"
  local body="${3:-}"

  cf_require_tools
  cf_require_token

  if [[ -n "$body" ]]; then
    curl -fsS \
      -X "$method" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$body" \
      "${CF_API_BASE}${path}"
  else
    curl -fsS \
      -X "$method" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      "${CF_API_BASE}${path}"
  fi
}

cf_zone_id_by_name() {
  local zone_name="$1"
  cf_api GET "/zones?name=${zone_name}" | jq -r '.result[0].id // empty'
}

cf_dns_record_id() {
  local zone_id="$1"
  local name="$2"
  cf_api GET "/zones/${zone_id}/dns_records?name=${name}" | jq -r '.result[0].id // empty'
}

cf_validate_zone_id() {
  [[ "$1" =~ ^[a-f0-9]{32}$ ]] || cf_fail "invalid Cloudflare zone id: $1"
}

cf_validate_tunnel_uuid() {
  [[ "$1" =~ ^[0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{12}$ ]] || cf_fail "invalid Cloudflare tunnel UUID: $1"
}


cf_tunnel_id_by_name() {
  local account_id="$1"
  local tunnel_name="$2"

  [[ -n "$account_id" ]] || cf_fail "missing Cloudflare account id"
  [[ -n "$tunnel_name" ]] || cf_fail "missing Cloudflare tunnel name"

  cf_api GET "/accounts/${account_id}/cfd_tunnel?name=${tunnel_name}" \
    | jq -r '.result[0].id // empty'
}

cf_tunnel_id_first_healthy() {
  local account_id="$1"

  [[ -n "$account_id" ]] || cf_fail "missing Cloudflare account id"

  cf_api GET "/accounts/${account_id}/cfd_tunnel" \
    | jq -r '
        (.result // [])
        | map(select((.deleted_at // null) == null))
        | sort_by(
            if (.status // "") == "healthy" then 0
            elif (.status // "") == "degraded" then 1
            elif (.status // "") == "inactive" then 2
            else 3 end
          )
        | .[0].id // empty
      '
}

cf_tunnel_list_report() {
  local account_id="$1"

  [[ -n "$account_id" ]] || cf_fail "missing Cloudflare account id"

  cf_api GET "/accounts/${account_id}/cfd_tunnel" \
    | jq -r '
        (.result // [])
        | map(select((.deleted_at // null) == null))
        | .[]
        | [.id, (.name // ""), (.status // ""), (.created_at // "")]
        | @tsv
      '
}
