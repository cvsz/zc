#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT="${ROOT_DIR}/docs/reports/generated/zc-cloudflare-api-preflight.md"
ENV_FILE="${ROOT_DIR}/.env.cloudflare.zc.generated"

[[ -f "$ENV_FILE" ]] || { echo "ERROR: missing $ENV_FILE; run make cf-zc-preflight first" >&2; exit 1; }
[[ -f "$REPORT" ]] || { echo "ERROR: missing $REPORT; run make cf-zc-preflight first" >&2; exit 1; }

set -a
source "$ENV_FILE"
set +a

cd "${ROOT_DIR}/infra/cloudflare"

grep "^terraform import" "$REPORT" | while IFS= read -r cmd; do
  echo "+ $cmd"
  eval "$cmd" || true
done

echo "Import complete. Run make tf-zc-plan next."
