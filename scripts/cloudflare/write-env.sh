#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# Safe writer for Cloudflare env file.
# Usage:
#   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_ZONE_ID=... ./write-env.sh [output-file]
# If no output-file provided, defaults to .env.cloudflare.

OUTPUT_FILE="${1:-.env.cloudflare}"
LOG_FILE="/tmp/zveo-cf-env.log"

exec > >(tee -a "$LOG_FILE") 2>&1

: "${CLOUDFLARE_ACCOUNT_ID:?Missing CLOUDFLARE_ACCOUNT_ID}"
: "${CLOUDFLARE_ZONE_ID:?Missing CLOUDFLARE_ZONE_ID}"

CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-}"
CLOUDFLARE_DNS_TOKEN="${CLOUDFLARE_DNS_TOKEN:-}"
CLOUDFLARE_ZT_TOKEN="${CLOUDFLARE_ZT_TOKEN:-}"
CLOUDFLARE_WORKERS_TOKEN="${CLOUDFLARE_WORKERS_TOKEN:-}"
CLOUDFLARE_WAF_TOKEN="${CLOUDFLARE_WAF_TOKEN:-}"
CLOUDFLARE_TUNNEL_TOKEN="${CLOUDFLARE_TUNNEL_TOKEN:-}"
CLOUDFLARE_R2_TOKEN="${CLOUDFLARE_R2_TOKEN:-}"

log(){ printf '[%s] %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*"; }
write_kv(){ printf '%s=%s\n' "$1" "${2:-}"; }

log "Writing Cloudflare env to ${OUTPUT_FILE}"
touch "${OUTPUT_FILE}"
chmod 600 "${OUTPUT_FILE}"

TMP="$(mktemp "${OUTPUT_FILE}.XXXXXX")"
chmod 600 "${TMP}"

{
  write_kv CLOUDFLARE_ACCOUNT_ID "$CLOUDFLARE_ACCOUNT_ID"
  write_kv CLOUDFLARE_ZONE_ID "$CLOUDFLARE_ZONE_ID"
  write_kv CLOUDFLARE_API_TOKEN "$CLOUDFLARE_API_TOKEN"
  write_kv CLOUDFLARE_DNS_TOKEN "$CLOUDFLARE_DNS_TOKEN"
  write_kv CLOUDFLARE_ZT_TOKEN "$CLOUDFLARE_ZT_TOKEN"
  write_kv CLOUDFLARE_WORKERS_TOKEN "$CLOUDFLARE_WORKERS_TOKEN"
  write_kv CLOUDFLARE_WAF_TOKEN "$CLOUDFLARE_WAF_TOKEN"
  write_kv CLOUDFLARE_TUNNEL_TOKEN "$CLOUDFLARE_TUNNEL_TOKEN"
  write_kv CLOUDFLARE_R2_TOKEN "$CLOUDFLARE_R2_TOKEN"
} > "${TMP}"

mv "${TMP}" "${OUTPUT_FILE}"
chmod 600 "${OUTPUT_FILE}"
bash scripts/cloudflare/clean-env-empty-values.sh "${OUTPUT_FILE}"

log "Cloudflare env written to ${OUTPUT_FILE} with permissions 600"
