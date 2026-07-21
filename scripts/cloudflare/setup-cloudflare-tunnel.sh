#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
usage() { cat <<'USAGE'
Usage: scripts/cloudflare/setup-cloudflare-tunnel.sh [--api-check]

Offline by default. Prints safe operator commands for the Terraform-managed
Tunnel. With --api-check, verifies cloudflared and a permission-restricted
token file without creating or changing Cloudflare resources.
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
  sudo install -d -o root -g cloudflared -m 750 /etc/cloudflared
  sudo install -o cloudflared -g cloudflared -m 400 <downloaded-token-file> /etc/cloudflared/zc.token
  sudo -u cloudflared cloudflared tunnel --no-autoupdate run --token-file /etc/cloudflared/zc.token

Terraform owns the Tunnel, Access application, policies, ingress, and DNS.
Do not create routes manually.
NEXT
  exit 0
fi
command -v cloudflared >/dev/null 2>&1 || { log 'cloudflared not found'; exit 3; }
token_file="${CLOUDFLARE_TUNNEL_TOKEN_FILE:-/etc/cloudflared/zc.token}"
[[ -f "$token_file" ]] || { log "token file not found: $token_file"; exit 4; }
mode="$(stat -c '%a' "$token_file")"
owner="$(stat -c '%U' "$token_file")"
[[ "$mode" == "600" || "$mode" == "400" ]] || {
  log "token file mode must be 600 or 400, got $mode"
  exit 5
}
[[ "$owner" == "cloudflared" ]] || {
  log "token file must be owned by cloudflared, got $owner"
  exit 6
}
log "api-check passed; token file is present with restrictive permissions"
log "no Cloudflare changes were made"
