#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# ZEAZDEV company loading page Worker - one click local installer
# Thai + English company loading page for zeaz.dev under Cloudflare Workers.
#
# Usage:
#   bash scripts/cloudflare/install-zeaz-loading-local.sh
#   bash scripts/cloudflare/install-zeaz-loading-local.sh --preview
#   bash scripts/cloudflare/install-zeaz-loading-local.sh --deploy
#
# Wrangler 4.x auth:
#   Prefer CLOUDFLARE_API_TOKEN.
#   Deprecated CLOUDFLARE_API_KEY is never used by this script.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKER_DIR="${ROOT_DIR}/workers/zeaz-loading"
SRC_DIR="${WORKER_DIR}/src"
WRANGLER_CONFIG="${WORKER_DIR}/wrangler.toml"
WORKER_SOURCE="${SRC_DIR}/index.js"

BRAND_NAME="${BRAND_NAME:-ZEAZDEV COMPANY LIMITED}"
APP_URL="${APP_URL:-https://zeaz.dev}"
ROUTE_PATTERN="${ROUTE_PATTERN:-zeaz.dev/*}"
ZONE_NAME="${ZONE_NAME:-zeaz.dev}"
MODE="install"

log() { printf '\033[1;36m[zeaz-loading]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
ZEAZDEV company loading page Worker one-click installer

Options:
  --install              Generate/update local files only. Default.
  --preview              Generate files and run local Wrangler preview.
  --deploy               Generate files and deploy to Cloudflare.
  --brand VALUE          Brand name. Default: ZEAZDEV COMPANY LIMITED
  --app-url URL          Public company URL. Default: https://zeaz.dev
  --route PATTERN        Worker route. Default: zeaz.dev/*
  --zone NAME            Cloudflare zone name. Default: zeaz.dev
  --help                 Show this help.

Modern Wrangler env:
  CLOUDFLARE_API_TOKEN   Required for token deploy without OAuth browser login.
  CLOUDFLARE_EMAIL       Optional.

Deprecated compatibility:
  CLOUDFLARE_API_KEY is intentionally ignored; use a scoped CLOUDFLARE_API_TOKEN.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install) MODE="install"; shift ;;
    --preview) MODE="preview"; shift ;;
    --deploy) MODE="deploy"; shift ;;
    --brand) BRAND_NAME="${2:-}"; shift 2 ;;
    --app-url) APP_URL="${2:-}"; shift 2 ;;
    --route) ROUTE_PATTERN="${2:-}"; shift 2 ;;
    --zone) ZONE_NAME="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
done

require_cmd() { command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"; }

ensure_node_tooling() {
  require_cmd node
  require_cmd npm
  require_cmd npx
}

normalize_wrangler_auth_env() {
  if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    warn "CLOUDFLARE_API_TOKEN is not set. Wrangler may open OAuth login."
    warn "Fix: export CLOUDFLARE_API_TOKEN='your-scoped-cloudflare-token'"
  fi
}

run_wrangler() {
  normalize_wrangler_auth_env
  env -u CLOUDFLARE_API_KEY npx wrangler "$@"
}

write_worker_files() {
  [[ -n "${BRAND_NAME}" ]] || fail "BRAND_NAME cannot be empty"
  [[ -n "${APP_URL}" ]] || fail "APP_URL cannot be empty"
  [[ -n "${ROUTE_PATTERN}" ]] || fail "ROUTE_PATTERN cannot be empty"
  [[ -n "${ZONE_NAME}" ]] || fail "ZONE_NAME cannot be empty"

  log "Creating worker directory: ${WORKER_DIR}"
  mkdir -p "${SRC_DIR}"

  cat > "${WRANGLER_CONFIG}" <<EOF_WRANGLER
name = "zeaz-loading"
main = "src/index.js"
compatibility_date = "2026-05-24"
workers_dev = false

routes = [
  { pattern = "${ROUTE_PATTERN}", zone_name = "${ZONE_NAME}" }
]

[vars]
BRAND_NAME = "${BRAND_NAME}"
APP_URL = "${APP_URL}"
EOF_WRANGLER

  [[ -f "${WORKER_SOURCE}" ]] || fail "Missing worker source: ${WORKER_SOURCE}"
  node --check "${WORKER_SOURCE}" >/dev/null

  chmod +x "${ROOT_DIR}/scripts/cloudflare/install-zeaz-loading-local.sh" 2>/dev/null || true
  log "Generated: ${WRANGLER_CONFIG}"
  log "Validated: ${WORKER_SOURCE}"
}

run_preview() {
  ensure_node_tooling
  log "Starting local preview at http://127.0.0.1:8787"
  cd "${ROOT_DIR}"
  run_wrangler dev --config "${WRANGLER_CONFIG}" --local --ip 127.0.0.1 --port 8787
}

run_deploy() {
  ensure_node_tooling
  log "Deploying to Cloudflare route ${ROUTE_PATTERN}"
  cd "${ROOT_DIR}"
  run_wrangler deploy --config "${WRANGLER_CONFIG}"
}

main() {
  log "Installing ZEAZDEV company loading page worker"
  log "Root: ${ROOT_DIR}"
  write_worker_files

  case "${MODE}" in
    install)
      log "Install complete. Preview: bash scripts/cloudflare/install-zeaz-loading-local.sh --preview"
      log "Deploy: bash scripts/cloudflare/install-zeaz-loading-local.sh --deploy"
      ;;
    preview)
      run_preview
      ;;
    deploy)
      run_deploy
      ;;
    *) fail "Invalid mode: ${MODE}" ;;
  esac
}

main "$@"
