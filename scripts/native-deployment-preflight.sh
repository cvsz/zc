#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
failures=0
require_installed=false

case "${1:-}" in
  "") ;;
  --require-installed) require_installed=true ;;
  --help|-h)
    echo "Usage: scripts/native-deployment-preflight.sh [--require-installed]"
    exit 0
    ;;
  *)
    echo "Unknown argument: $1" >&2
    exit 2
    ;;
esac

pass() { printf 'PASS: %s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; failures=$((failures + 1)); }
missing_install() {
  if $require_installed; then fail "$*"; else warn "$*"; fi
}
installed_drift() {
  if $require_installed; then fail "$*"; else warn "$*"; fi
}

for command in systemctl systemd-analyze cloudflared ss stat; do
  command -v "$command" >/dev/null 2>&1 ||
    fail "required command is unavailable: $command"
done

systemd_query_available=false
if systemctl list-units --type=service --no-pager >/dev/null 2>&1; then
  systemd_query_available=true
fi

verify_unit_source() {
  local unit=$1 path="${ROOT}/deploy/systemd/$1" verify_path temporary=
  if [[ ! -f "$path" ]]; then
    fail "missing unit source: $path"
    return
  fi
  verify_path=$path
  if [[ "$unit" == "zc.service" && ! -x /opt/zc/.venv/bin/zc ]]; then
    temporary="$(mktemp --suffix=.service)"
    sed 's|^ExecStart=.*|ExecStart=/bin/true|' "$path" >"$temporary"
    verify_path=$temporary
  fi
  if systemd-analyze verify "$verify_path" >/dev/null 2>&1; then
    pass "$unit source passes systemd verification"
  else
    fail "$unit source failed systemd verification"
  fi
  [[ -z "$temporary" ]] || rm -f "$temporary"
}

for unit in zc.service cloudflared-zc.service; do
  verify_unit_source "$unit"
done

grep -Fq 'ExecStart=/opt/zc/.venv/bin/zc --host 127.0.0.1 --port 8000 --workers 1' \
  "${ROOT}/deploy/systemd/zc.service" ||
  fail "zc.service does not enforce the canonical loopback command"
grep -Fq -- '--token-file /etc/cloudflared/zc.token' \
  "${ROOT}/deploy/systemd/cloudflared-zc.service" ||
  fail "cloudflared-zc.service does not use the canonical token file"

if ! $systemd_query_available; then
  missing_install "systemd manager is not queryable from this context"
elif systemctl is-active --quiet cloudflared.service; then
  warn "legacy cloudflared.service is active; review hostname overlap before cutover"
else
  pass "legacy cloudflared.service is not active"
fi

for unit in zc.service cloudflared-zc.service; do
  if ! $systemd_query_available; then
    missing_install "$unit installation state cannot be verified without systemd access"
  elif systemctl cat "$unit" >/dev/null 2>&1; then
    pass "$unit is installed"
  else
    missing_install "$unit is not installed"
  fi
done

check_private_file() {
  local path=$1 owner=$2
  if [[ ! -f "$path" ]]; then
    missing_install "$path is not installed"
    return
  fi
  local actual_owner mode
  actual_owner="$(stat -c '%U' "$path")"
  mode="$(stat -c '%a' "$path")"
  [[ "$actual_owner" == "$owner" ]] ||
    installed_drift "$path owner is $actual_owner, expected $owner"
  [[ "$mode" == "600" || "$mode" == "400" ]] ||
    installed_drift "$path mode is $mode, expected 600 or 400"
}

check_private_file /etc/zc/zc.env root
check_private_file /etc/cloudflared/zc.token cloudflared

check_directory() {
  local path=$1 owner=$2 group=$3 mode=$4
  if [[ ! -d "$path" ]]; then
    missing_install "$path is not installed"
    return
  fi
  local actual_owner actual_group actual_mode
  actual_owner="$(stat -c '%U' "$path")"
  actual_group="$(stat -c '%G' "$path")"
  actual_mode="$(stat -c '%a' "$path")"
  [[ "$actual_owner:$actual_group" == "$owner:$group" ]] ||
    installed_drift "$path owner is $actual_owner:$actual_group, expected $owner:$group"
  [[ "$actual_mode" == "$mode" ]] ||
    installed_drift "$path mode is $actual_mode, expected $mode"
}

check_directory /opt/zc root root 755
check_directory /var/lib/zc zc zc 700
check_directory /etc/zc root root 700
check_directory /etc/cloudflared root cloudflared 750

if [[ -x /opt/zc/.venv/bin/zc ]]; then
  pass "installed zc command is executable"
else
  missing_install "/opt/zc/.venv/bin/zc is not executable"
fi

if ss -ltnH '( sport = :8000 or sport = :8001 )' 2>/dev/null | grep -q .; then
  while read -r listener; do
    [[ "$listener" == *"127.0.0.1:"* || "$listener" == *"[::1]:"* ]] ||
      fail "zc listener is not loopback-only: $listener"
  done < <(ss -ltnH '( sport = :8000 or sport = :8001 )' 2>/dev/null)
else
  missing_install "no zc listener is active on port 8000 or 8001"
fi

if ((failures)); then
  printf 'Preflight failed with %d blocking issue(s).\n' "$failures" >&2
  exit 1
fi

pass "native deployment preflight completed without blocking issues"
