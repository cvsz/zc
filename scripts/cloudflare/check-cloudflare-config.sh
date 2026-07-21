#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

usage(){ cat <<'USAGE'
Usage: check-cloudflare-config.sh [--config PATH] [--api-check]

Offline validates the canonical remote-managed Tunnel configuration in
Terraform. --api-check only verifies that required Cloudflare env variables are
present; it does not print values.
USAGE
}

log(){ printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
trap 'log "ERROR: Cloudflare config check failed at line $LINENO"' ERR

config=infra/cloudflare/main.tf
api=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --config) config="${2:?missing config}"; shift 2;;
    --api-check) api=1; shift;;
    --help|-h) usage; exit 0;;
    *) echo "ERROR: unknown argument $1" >&2; exit 2;;
  esac
done

[ -f "$config" ] || { echo "ERROR: missing $config" >&2; exit 1; }
python3 - "$config" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")

required_fragments = (
    'resource "cloudflare_zero_trust_tunnel_cloudflared_config" "zc"',
    "hostname = var.zc_domain",
    "service  = var.local_origin_url",
    "aud_tag   = [cloudflare_zero_trust_access_application.zc.aud]",
    "team_name = var.cloudflare_access_team_name",
    "required  = true",
    'service = "http_status:404"',
)
for fragment in required_fragments:
    if fragment not in text:
        raise SystemExit(f"missing canonical Tunnel contract: {fragment}")

for retired in ("zai.zeaz.dev", "api.zeaz.dev"):
    if retired in text:
        raise SystemExit(f"retired dual-hostname remains in config: {retired}")

if text.index("hostname = var.zc_domain") > text.index('service = "http_status:404"'):
    raise SystemExit("http_status:404 must be the terminal Tunnel ingress rule")
PY

if [ "$api" -eq 1 ]; then
  for name in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_ZONE_ID CLOUDFLARE_TUNNEL_ID; do
    [ -n "${!name:-}" ] || { echo "ERROR: $name is required for --api-check" >&2; exit 1; }
  done
  log "Cloudflare API env presence check passed (values not printed)"
fi

log "Cloudflare Terraform ingress validation passed"
