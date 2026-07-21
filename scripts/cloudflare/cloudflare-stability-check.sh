#!/usr/bin/env bash
set -Eeuo pipefail

fail=0

ok() { printf 'PASS: %s\n' "$*"; }
bad() { printf 'FAIL: %s\n' "$*" >&2; fail=1; }
warn() { printf 'WARN: %s\n' "$*" >&2; }

check_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    ok "command found: $1"
  else
    warn "command missing: $1"
  fi
}

echo "=== Cloudflare Stability Check ==="

echo
echo "--- Cost / paid feature guardrails ---"
check_guard() {
  local actual="$1"
  local expected="$2"
  local success_message="$3"
  local failure_message="$4"

  if [[ "$actual" == "$expected" ]]; then
    ok "$success_message"
  else
    bad "$failure_message"
  fi
}

check_guard "${COST_LOCK:-true}" "true" "COST_LOCK=true" "COST_LOCK must be true"
check_guard "${CLOUDFLARE_PLAN_TIER:-Free}" "Free" "CLOUDFLARE_PLAN_TIER=Free" "CLOUDFLARE_PLAN_TIER must be Free"
check_guard "${ALLOW_PAID_CLOUDFLARE_FEATURES:-false}" "false" "paid Cloudflare features disabled" "ALLOW_PAID_CLOUDFLARE_FEATURES must be false"
check_guard "${ALLOW_LOAD_BALANCING:-false}" "false" "Load Balancing disabled" "ALLOW_LOAD_BALANCING must be false"
check_guard "${ALLOW_ADVANCED_WAF:-false}" "false" "Advanced WAF disabled" "ALLOW_ADVANCED_WAF must be false"
check_guard "${ALLOW_LOGPUSH:-false}" "false" "Logpush disabled" "ALLOW_LOGPUSH must be false"
check_guard "${ALLOW_R2_WRITE:-false}" "false" "R2 writes disabled" "ALLOW_R2_WRITE must be false"
check_guard "${ALLOW_WORKERS_DEPLOY:-false}" "false" "Workers deploy disabled" "ALLOW_WORKERS_DEPLOY must be false"

echo
echo "--- Forbidden global API key variables ---"
for key in CLOUDFLARE_API_KEY CF_API_KEY GLOBAL_API_KEY; do
  if [[ -n "${!key:-}" ]]; then
    bad "global key variable is set: $key"
  else
    ok "not set: $key"
  fi
done

echo
echo "--- Required local tools ---"
check_cmd git
check_cmd curl
check_cmd bash
check_cmd python3
check_cmd cloudflared
check_cmd terraform
check_cmd tofu

echo
echo "--- Repository safety ---"
if git ls-files | grep -Eq '(^|/)(\.env|\.env\.cloudflare|\.env\..*|.*\.env)$'; then
  bad "tracked env file found"
  git ls-files | grep -E '(^|/)(\.env|\.env\.cloudflare|\.env\..*|.*\.env)$' >&2 || true
else
  ok "no tracked env files"
fi

if git status --short | grep -E '^\?\? .*(\.env|\.env\.cloudflare|\.env\..*|.*\.env)$' >/dev/null 2>&1; then
  warn "local untracked env files exist; OK if chmod 600 and never committed"
fi

echo
echo "--- Source validation ---"
bash -n "${BASH_SOURCE[0]}" scripts/cloudflare/*.sh
scripts/cloudflare/check-cloudflare-config.sh
terraform -chdir=infra/cloudflare fmt -check -recursive
terraform -chdir=infra/cloudflare validate
python3 - <<'PY'
from pathlib import Path

import yaml

for path in sorted(Path(".github/workflows").glob("*.y*ml")):
    with path.open(encoding="utf-8") as stream:
        yaml.safe_load(stream)
    print(f"PASS: valid YAML: {path}")
PY

echo
echo "--- Cloudflare plan dry-run ---"
COST_LOCK=true \
CLOUDFLARE_PLAN_TIER=Free \
ALLOW_PAID_CLOUDFLARE_FEATURES=false \
make zc-plan

echo
echo "--- Live public route check ---"
set +e
make zc-verify-live
live_rc=$?
set -e
if [[ "$live_rc" -eq 0 ]]; then
  ok "live verifier completed"
else
  warn "live verifier returned non-zero; inspect generated report"
fi

echo
echo "--- Direct live HTTP checks ---"
check_url() {
  local name="$1"
  local url="$2"
  local code
  code="$(curl -L -sS -o /dev/null -w '%{http_code}' "$url" || true)"
  printf '%s -> %s\n' "$url" "$code"

  case "$name:$code" in
    www:200|www:301|www:302) ok "$name reachable" ;;
    apex:200|apex:301|apex:302) ok "$name reachable" ;;
    zc:200|zc:301|zc:302|zc:403) ok "$name reachable or intentionally protected" ;;
    api:200|api:401|api:403|api:405) ok "$name reachable or method/auth protected" ;;
    release:200|release:301|release:302|release:403|release:000) warn "$name optional or not yet published: $code" ;;
    *) warn "$name unexpected HTTP code: $code" ;;
  esac
}

check_url apex "https://zeaz.dev"
check_url www "https://www.zeaz.dev"
check_url zc "https://${ZC_PUBLIC_HOST:-zeaz.dev}"
check_url api "https://${ZC_PUBLIC_HOST:-zeaz.dev}/v1/wire/health/live"

echo
if [[ "$fail" -ne 0 ]]; then
  echo "Cloudflare stability check failed."
  exit 1
fi

echo "Cloudflare stability check complete."
