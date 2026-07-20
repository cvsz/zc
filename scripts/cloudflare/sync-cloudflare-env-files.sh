#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SOURCE_FILE="${1:-.env.cloudflare}"
DEST_FILE="${2:-.env}"

[[ -f "$SOURCE_FILE" ]] || {
  echo "ERROR: source env file not found: $SOURCE_FILE" >&2
  exit 1
}

touch "$DEST_FILE"
chmod 600 "$DEST_FILE"

MANAGED_KEYS=(
  CLOUDFLARE_ACCOUNT_ID
  CLOUDFLARE_ZONE_ID
  CLOUDFLARE_AI_GATEWAY_SLUG
  CLOUDFLARE_DNS_TOKEN
  CLOUDFLARE_ZT_TOKEN
  CLOUDFLARE_WORKERS_TOKEN
  CLOUDFLARE_PAGES_TOKEN
  CLOUDFLARE_WAF_TOKEN
  CLOUDFLARE_TUNNEL_TOKEN
  CLOUDFLARE_R2_TOKEN
  CLOUDFLARE_D1_TOKEN
  CLOUDFLARE_AUDIT_TOKEN
  CLOUDFLARE_AI_GATEWAY_TOKEN
)

is_managed_key() {
  local key="$1"
  local k
  for k in "${MANAGED_KEYS[@]}"; do
    [[ "$key" == "$k" ]] && return 0
  done
  return 1
}

env_value() {
  local file="$1"
  local key="$2"

  awk -F= -v k="$key" '
    $1 == k {
      v=$0
      sub(/^[^=]*=/, "", v)
      print v
    }
  ' "$file" | tail -n 1
}

tmp="$(mktemp "${DEST_FILE}.XXXXXX")"
chmod 600 "$tmp"

while IFS= read -r line || [[ -n "$line" ]]; do
  key="$(printf '%s' "$line" | sed -E 's/^([A-Za-z0-9_]+)=.*/\1/')"
  if is_managed_key "$key"; then
    continue
  fi
  printf '%s\n' "$line" >> "$tmp"
done < "$DEST_FILE"

{
  echo
  echo "# Synced Cloudflare managed values from ${SOURCE_FILE}"
  echo "# Updated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >> "$tmp"

for key in "${MANAGED_KEYS[@]}"; do
  value="$(env_value "$SOURCE_FILE" "$key" || true)"
  [[ -n "${value//[[:space:]]/}" ]] || continue
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
done

mv "$tmp" "$DEST_FILE"
chmod 600 "$DEST_FILE"

if [[ -x scripts/cloudflare/clean-env-empty-values.sh ]]; then
  bash scripts/cloudflare/clean-env-empty-values.sh "$DEST_FILE"
fi

echo "PASS: synced Cloudflare managed values from ${SOURCE_FILE} to ${DEST_FILE}"
