#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

fail() { echo "ERROR: $*" >&2; exit 1; }
require() { [[ "${!1:-}" == "$2" ]] || fail "$1 must be $2"; }

require APPLY true
require COST_LOCK true
require ALLOW_PAID_CLOUDFLARE_FEATURES false
require CLOUDFLARE_PLAN_TIER Free

[[ "${CONFIRM_DNS_APPLY:-no}" == "yes" ]] || fail "CONFIRM_DNS_APPLY=yes required"
[[ "${CONFIRM_TUNNEL_APPLY:-no}" == "yes" ]] || fail "CONFIRM_TUNNEL_APPLY=yes required"
[[ "${CONFIRM_ACCESS_APPLY:-no}" == "yes" ]] || fail "CONFIRM_ACCESS_APPLY=yes required"
[[ "${DRY_RUN:-true}" == "true" ]] || fail "DRY_RUN=true is required for this phase"

for forbidden in CLOUDFLARE_API_KEY CF_API_KEY GLOBAL_API_KEY; do
  if [[ -n "${!forbidden:-}" ]]; then
    fail "refusing to use global API key variable: $forbidden"
  fi
done

echo "=== zeaz.dev controlled apply ==="
echo "Dry run mode: ${DRY_RUN}"
echo "No Cloudflare mutations are performed by this repository step."
echo "Review the live provider commands manually before execution."
echo
bash "${ROOT_DIR}/scripts/cloudflare/zc-plan.sh"
