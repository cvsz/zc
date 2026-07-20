#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# shellcheck disable=SC1091
source secrets/cloudflare.env

required=(
  CLOUDFLARE_DNS_TOKEN
  CLOUDFLARE_ZT_TOKEN
  CLOUDFLARE_WORKERS_TOKEN
  CLOUDFLARE_WAF_TOKEN
  CLOUDFLARE_TUNNEL_TOKEN
  CLOUDFLARE_R2_TOKEN
)

log() {
  printf '\n[%s] %s\n' \
    "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    "$*"
}

validate_token() {
  local name="$1"
  local token="$2"

  log "Validating ${name}"

  response="$(
    curl -sS \
      "https://api.cloudflare.com/client/v4/user/tokens/verify" \
      -H "Authorization: Bearer ${token}"
  )"

  success="$(echo "${response}" | jq -r '.success')"

  if [[ "${success}" != "true" ]]; then
    echo "${response}" | jq
    exit 1
  fi

  log "${name} valid"
}

for key in "${required[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    log "Missing variable: ${key}"
    exit 1
  fi
done

validate_token "CLOUDFLARE_DNS_TOKEN" "${CLOUDFLARE_DNS_TOKEN}"
validate_token "CLOUDFLARE_ZT_TOKEN" "${CLOUDFLARE_ZT_TOKEN}"
validate_token "CLOUDFLARE_WORKERS_TOKEN" "${CLOUDFLARE_WORKERS_TOKEN}"
validate_token "CLOUDFLARE_WAF_TOKEN" "${CLOUDFLARE_WAF_TOKEN}"
validate_token "CLOUDFLARE_TUNNEL_TOKEN" "${CLOUDFLARE_TUNNEL_TOKEN}"
validate_token "CLOUDFLARE_R2_TOKEN" "${CLOUDFLARE_R2_TOKEN}"

log "All tokens validated successfully"
