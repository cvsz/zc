#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
usage() { cat <<'USAGE'
Usage: scripts/cloudflare/setup-cloudflare-tunnel.sh [--api-check]

Offline by default. Prints safe operator commands. With --api-check, verifies cloudflared is installed and token env names are present, but does not create routes unless CONFIRM_APPLY=yes.
USAGE
}
log() { printf '[zeaz-cloudflare-setup] %s\n' "$*"; }
api_check=false
while (($#)); do case "$1" in --api-check) api_check=true; shift;; --help|-h) usage; exit 0;; *) usage; exit 2;; esac; done
scripts/cloudflare/check-cloudflare-config.sh
if ! $api_check; then
  log 'offline validation complete; no Cloudflare API calls made'
  cat <<'NEXT'
Manual next steps after setting local secrets:
  cloudflared tunnel login
  cloudflared tunnel create "$CLOUDFLARE_TUNNEL_NAME"
  cloudflared tunnel route dns "$CLOUDFLARE_TUNNEL_NAME" <hostname>
  cloudflared tunnel --config generated/cloudflare/zc-production-tunnel-ingress.yml run
NEXT
  exit 0
fi
command -v cloudflared >/dev/null 2>&1 || { log 'cloudflared not found'; exit 3; }
: "${CLOUDFLARE_TUNNEL_NAME:?CLOUDFLARE_TUNNEL_NAME required for api check}"
[[ "${CONFIRM_APPLY:-}" == yes ]] || { log 'api-check passed locally; set CONFIRM_APPLY=yes for manual route creation commands'; exit 0; }
log 'CONFIRM_APPLY=yes set, but this script intentionally does not automate DNS route creation yet; run printed commands manually.'
