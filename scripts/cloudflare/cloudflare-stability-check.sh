#!/usr/bin/env bash
set -Eeuo pipefail

fail=0

ok() { printf 'PASS: %s\n' "$*"; }
bad() { printf 'FAIL: %s\n' "$*" >&2; fail=1; }
warn() { printf 'WARN: %s\n' "$*" >&2; }

check_cmd() {
  command -v "$1" >/dev/null 2>&1 && ok "command found: $1" || warn "command missing: $1"
}

echo "=== Cloudflare Stability Check ==="

echo
echo "--- Cost / paid feature guardrails ---"
[[ "${COST_LOCK:-true}" == "true" ]] && ok "COST_LOCK=true" || bad "COST_LOCK must be true"
[[ "${CLOUDFLARE_PLAN_TIER:-Free}" == "Free" ]] && ok "CLOUDFLARE_PLAN_TIER=Free" || bad "CLOUDFLARE_PLAN_TIER must be Free"
[[ "${ALLOW_PAID_CLOUDFLARE_FEATURES:-false}" == "false" ]] && ok "paid Cloudflare features disabled" || bad "ALLOW_PAID_CLOUDFLARE_FEATURES must be false"
[[ "${ALLOW_LOAD_BALANCING:-false}" == "false" ]] && ok "Load Balancing disabled" || bad "ALLOW_LOAD_BALANCING must be false"
[[ "${ALLOW_ADVANCED_WAF:-false}" == "false" ]] && ok "Advanced WAF disabled" || bad "ALLOW_ADVANCED_WAF must be false"
[[ "${ALLOW_LOGPUSH:-false}" == "false" ]] && ok "Logpush disabled" || bad "ALLOW_LOGPUSH must be false"
[[ "${ALLOW_R2_WRITE:-false}" == "false" ]] && ok "R2 writes disabled" || bad "ALLOW_R2_WRITE must be false"
[[ "${ALLOW_WORKERS_DEPLOY:-false}" == "false" ]] && ok "Workers deploy disabled" || bad "ALLOW_WORKERS_DEPLOY must be false"

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
make yaml-validate
make workflow-validate
make phase51-validate
make phase52-validate

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
check_url zc "https://${ZC_PUBLIC_HOST:-zai.zeaz.dev}"
check_url api "https://${ZC_API_PUBLIC_HOST:-api.zeaz.dev}/v1/wire/health/live"

echo
if [[ "$fail" -ne 0 ]]; then
  echo "Cloudflare stability check failed."
  exit 1
fi

echo "Cloudflare stability check complete."
