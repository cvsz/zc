#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INTENT_FILE="${ROOT_DIR}/configs/cloudflare/zc/zc-route-intent.example.json"
ZC_ROUTES_FILE="${ROOT_DIR}/configs/cloudflare/zc/zc.production.routes.example.json"
ACCESS_FILE="${ROOT_DIR}/configs/cloudflare/access/zc-zc-access-policy.example.json"
TERRAFORM_FILE="${ROOT_DIR}/infra/cloudflare/main.tf"

redact() { sed -E 's/(token|secret|key|password|authorization)[^[:alnum:]]*[[:space:]]*[:=][[:space:]]*[^[:space:]]+/\1=[REDACTED]/Ig'; }

for path in "$INTENT_FILE" "$ZC_ROUTES_FILE" "$ACCESS_FILE" "$TERRAFORM_FILE"; do
  [[ -f "$path" ]] || { echo "ERROR: missing $path" >&2; exit 1; }
done

echo "=== zeaz.dev route plan ==="
echo "dry-run: true"
echo "apply_required: APPLY=true"
echo "cost_lock_required: true"
echo "paid_features_allowed: false"
echo
echo "--- route intent ---"
redact <"$INTENT_FILE"
echo
echo "--- zc routes ---"
redact <"$ZC_ROUTES_FILE"
echo
echo "--- access policy ---"
redact <"$ACCESS_FILE"
echo
echo "--- canonical Terraform resources ---"
redact <"$TERRAFORM_FILE"
echo
echo "No Cloudflare changes were made."
