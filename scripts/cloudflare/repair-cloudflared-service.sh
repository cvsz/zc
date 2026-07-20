#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

log(){ printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail(){ log "ERROR: $*" >&2; exit 1; }
has(){ command -v "$1" >/dev/null 2>&1; }

ROOT="${PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
CF_ENV_FILE="${CF_ENV_FILE:-$ROOT/.env.cloudflare}"
SERVICE_NAME="${SERVICE_NAME:-cloudflared}"
TUNNEL_HEALTH_URL="${TUNNEL_HEALTH_URL:-https://zveo.zeaz.dev/}"

load_env(){
  local file="$1"
  [[ -f "$file" ]] || return 0
  set -a
  # shellcheck disable=SC1090
  source "$file"
  set +a
  log "loaded env file: $file"
}

load_env "$CF_ENV_FILE"
load_env "$ENV_FILE"

has cloudflared || fail "cloudflared is not installed; run make bootstrap first"
has systemctl || fail "systemctl is required to install/manage cloudflared service"

[[ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]] || fail "CLOUDFLARE_TUNNEL_TOKEN is missing; set it in .env.cloudflare or environment"

if systemctl list-unit-files | awk '{print $1}' | grep -qx "${SERVICE_NAME}.service"; then
  log "${SERVICE_NAME}.service already installed"
else
  log "installing ${SERVICE_NAME}.service from CLOUDFLARE_TUNNEL_TOKEN"
  sudo cloudflared service install "$CLOUDFLARE_TUNNEL_TOKEN"
fi

log "enabling and restarting ${SERVICE_NAME}.service"
sudo systemctl enable --now "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

log "service status"
sudo systemctl --no-pager --full status "$SERVICE_NAME" || true

log "recent logs"
sudo journalctl -u "$SERVICE_NAME" -n 80 --no-pager || true

log "health probe: $TUNNEL_HEALTH_URL"
if curl -fsSIL --max-redirs 5 "$TUNNEL_HEALTH_URL" >/tmp/cloudflared-health.headers 2>/tmp/cloudflared-health.err; then
  cat /tmp/cloudflared-health.headers
  log "cloudflared repair completed; endpoint responded without curl failure"
else
  rc=$?
  cat /tmp/cloudflared-health.headers 2>/dev/null || true
  cat /tmp/cloudflared-health.err 2>/dev/null || true
  fail "health probe failed with curl rc=$rc; inspect cloudflared logs and origin service"
fi
