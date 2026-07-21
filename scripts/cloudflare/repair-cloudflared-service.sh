#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

log(){ printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail(){ log "ERROR: $*" >&2; exit 1; }
has(){ command -v "$1" >/dev/null 2>&1; }

ROOT="${PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
SERVICE_NAME="${SERVICE_NAME:-cloudflared-zc}"
TOKEN_FILE="${CLOUDFLARE_TUNNEL_TOKEN_FILE:-/etc/cloudflared/zc.token}"
UNIT_SOURCE="${ROOT}/deploy/systemd/cloudflared-zc.service"
APPLY="${APPLY:-false}"
CONFIRM_SYSTEMD_INSTALL="${CONFIRM_SYSTEMD_INSTALL:-no}"
CONFIRM_LEGACY_TUNNEL_COEXISTENCE="${CONFIRM_LEGACY_TUNNEL_COEXISTENCE:-no}"

has cloudflared || fail "cloudflared is not installed; run make bootstrap first"
has systemctl || fail "systemctl is required to install/manage cloudflared service"
id -u cloudflared >/dev/null 2>&1 ||
  fail "cloudflared service user does not exist"

[[ -f "$TOKEN_FILE" ]] || fail "missing Tunnel token file: $TOKEN_FILE"
[[ -f "$UNIT_SOURCE" ]] || fail "missing hardened systemd unit: $UNIT_SOURCE"
token_mode="$(stat -c '%a' "$TOKEN_FILE")"
token_owner="$(stat -c '%U' "$TOKEN_FILE")"
[[ "$token_mode" == "600" || "$token_mode" == "400" ]] ||
  fail "Tunnel token file mode must be 600 or 400"
[[ "$token_owner" == "cloudflared" ]] ||
  fail "Tunnel token file must be owned by cloudflared"

legacy_active=false
if systemctl is-active --quiet cloudflared.service; then
  legacy_active=true
  log "legacy cloudflared.service is active; it may remain online for unrelated hostnames during the zc cutover"
fi

if [[ "$APPLY" != "true" || "$CONFIRM_SYSTEMD_INSTALL" != "yes" ]]; then
  log "dry-run: native service mutation is disabled"
  log "validated unit source: $UNIT_SOURCE"
  log "validated token file: owner=cloudflared mode=$token_mode"
  log "to install after explicit approval: APPLY=true CONFIRM_SYSTEMD_INSTALL=yes $0"
  exit 0
fi
if $legacy_active && [[ "$CONFIRM_LEGACY_TUNNEL_COEXISTENCE" != "yes" ]]; then
  fail "set CONFIRM_LEGACY_TUNNEL_COEXISTENCE=yes after reviewing the existing tunnel routes"
fi

log "installing hardened ${SERVICE_NAME}.service"
sudo install -o root -g root -m 0644 \
  "$UNIT_SOURCE" "/etc/systemd/system/${SERVICE_NAME}.service"
sudo systemctl daemon-reload

log "enabling and restarting ${SERVICE_NAME}.service"
sudo systemctl enable --now "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

log "service status"
sudo systemctl --no-pager --full status "$SERVICE_NAME" || true

log "recent logs"
sudo journalctl -u "$SERVICE_NAME" -n 80 --no-pager || true

curl -fsS http://127.0.0.1:8000/ready >/dev/null ||
  fail "local zc readiness failed after cloudflared installation"
log "cloudflared installation completed; verify the external Access deny and allow flows separately"
