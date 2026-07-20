#!/usr/bin/env bash
set -Eeuo pipefail

API="https://api.cloudflare.com/client/v4"

: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID required}"
: "${CLOUDFLARE_BOOTSTRAP_TOKEN:?CLOUDFLARE_BOOTSTRAP_TOKEN required}"

cf_api() {
  local method="$1"
  local endpoint="$2"
  local payload="${3:-}"

  local args=(
    -sS
    -X "$method"
    "$API$endpoint"
    -H "Authorization: Bearer $CLOUDFLARE_BOOTSTRAP_TOKEN"
    -H "Content-Type: application/json"
  )

  [[ -n "$payload" ]] && args+=(--data "$payload")
  curl "${args[@]}"
}

permission_id_by_name() {
  local name="$1"

  cf_api GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/tokens/permission_groups" |
    jq -r --arg name "$name" '
      (.result // [])
      | map(select(.name == $name))
      | .[0].id // empty
    '
}
