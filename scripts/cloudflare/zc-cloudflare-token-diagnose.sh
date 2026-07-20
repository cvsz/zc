#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${ROOT_DIR}/scripts/cloudflare/cloudflare-api-lib.sh"

ZONE_NAME="${ZONE_NAME:-zeaz.dev}"
ZONE_ID="${TF_VAR_cloudflare_zone_id:-${CLOUDFLARE_ZONE_ID:-}}"

cf_require_tools
cf_require_token

echo "=== Cloudflare token diagnostic for zc ==="

echo "--- token verify ---"
if cf_api GET "/user/tokens/verify" | jq -c '{success, result: {id: .result.id, status: .result.status}}'; then
  echo "PASS: token verify"
else
  echo "FAIL: token verify"
fi

if [[ -n "$ZONE_ID" && "$ZONE_ID" != REPLACE_* ]]; then
  echo "--- zone read by id ---"
  if cf_api GET "/zones/${ZONE_ID}" | jq -c '{success, zone: .result.name, id: .result.id}'; then
    echo "PASS: zone read by id"
  else
    echo "FAIL: zone read by id"
  fi

  echo "--- dns list by zone id ---"
  if cf_api GET "/zones/${ZONE_ID}/dns_records?per_page=1" | jq -c '{success, count: (.result | length)}'; then
    echo "PASS: dns record list"
  else
    echo "FAIL: dns record list"
  fi
else
  echo "WARN: CLOUDFLARE_ZONE_ID/TF_VAR_cloudflare_zone_id missing; skipping zone-id tests"
fi

echo "--- zone lookup by name ---"
if cf_api GET "/zones?name=${ZONE_NAME}" | jq -c '{success, count: (.result | length)}'; then
  echo "PASS: zone lookup by name"
else
  echo "WARN: zone lookup by name failed. This is OK if the token is zone-scoped and CLOUDFLARE_ZONE_ID is set."
fi
