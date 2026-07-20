#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INTENT_FILE="${ROOT_DIR}/configs/cloudflare/zc/zc-route-intent.example.json"
ZC_ROUTES_FILE="${ROOT_DIR}/configs/cloudflare/zc/zc.production.routes.example.json"
ACCESS_FILE="${ROOT_DIR}/configs/cloudflare/access/zc-zc-access-policy.example.json"
INGRESS_FILE="${ROOT_DIR}/generated/cloudflare/zc-production-tunnel-ingress.yml"

redact() { sed -E 's/(token|secret|key|password|authorization)[^[:alnum:]]*[[:space:]]*[:=][[:space:]]*[^[:space:]]+/\1=[REDACTED]/Ig'; }

for path in "$INTENT_FILE" "$ZC_ROUTES_FILE" "$ACCESS_FILE" "$INGRESS_FILE"; do
  [[ -f "$path" ]] || { echo "ERROR: missing $path" >&2; exit 1; }
done

echo "=== zeaz.dev route plan ==="
echo "dry-run: true"
echo "apply_required: APPLY=true"
echo "cost_lock_required: true"
echo "paid_features_allowed: false"
echo
echo "--- route intent ---"
cat "$INTENT_FILE" | redact
echo
echo "--- zc routes ---"
cat "$ZC_ROUTES_FILE" | redact
echo
echo "--- access policy ---"
cat "$ACCESS_FILE" | redact
echo
echo "--- tunnel ingress ---"
cat "$INGRESS_FILE" | redact
echo
echo "No Cloudflare changes were made."
