#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT="${ROOT_DIR}/docs/reports/generated/zc-live-verification.md"
mkdir -p "${ROOT_DIR}/docs/reports/generated"

urls=(
  "https://${ZC_PUBLIC_HOST:-zeaz.dev}"
  "https://${ZC_PUBLIC_HOST:-zeaz.dev}/v1/wire/health/live"
)

{
  echo "# zeaz.dev live verification"
  echo
  echo "Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo
  for url in "${urls[@]}"; do
    code="$(curl -k -sS -o /dev/null -w '%{http_code}' --max-time 15 "$url" || echo "000")"
    echo "- $url -> $code"
  done
} >"$REPORT"

cat "$REPORT"
