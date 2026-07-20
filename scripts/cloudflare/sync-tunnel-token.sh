#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# ─────────────────────────────────────────────────────────────────────────────
# sync-tunnel-token.sh — Extract CLOUDFLARE_TUNNEL_TOKEN from ~/.cloudflared
#
# Reads the locally-managed tunnel credential JSON from ~/.cloudflared/,
# base64-encodes it, and writes it as CLOUDFLARE_TUNNEL_TOKEN into the
# target .env file.
#
# Usage:
#   bash scripts/cloudflare/sync-tunnel-token.sh [OPTIONS]
#
# Options:
#   --env-file <path>   Target .env file (default: .env)
#   --cloudflared-dir   Path to cloudflared config dir (default: ~/.cloudflared)
#   --dry-run           Print token but do not write
#   --help              Show this help
# ─────────────────────────────────────────────────────────────────────────────

CLOUDFLARED_DIR="${HOME}/.cloudflared"
ENV_FILE=".env"
DRY_RUN=false

log() {
  printf '[%s] %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*"
}

err() {
  log "ERROR: $*" >&2
}

usage() {
  grep '^#' "$0" | sed 's/^# \?//' | head -20
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      [[ -n "${2:-}" ]] || { err "--env-file requires a value"; exit 2; }
      ENV_FILE="$2"; shift 2 ;;
    --cloudflared-dir)
      [[ -n "${2:-}" ]] || { err "--cloudflared-dir requires a value"; exit 2; }
      CLOUDFLARED_DIR="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --help|-h) usage ;;
    *) err "Unknown arg: $1"; exit 2 ;;
  esac
done

# ── Step 1: Find config.yml and extract tunnel ID ────────────────────────────
CONFIG_FILE="${CLOUDFLARED_DIR}/config.yml"
if [[ ! -f "${CONFIG_FILE}" ]]; then
  err "config.yml not found at ${CONFIG_FILE}"
  exit 1
fi

TUNNEL_ID=$(grep '^tunnel:' "${CONFIG_FILE}" | awk '{print $2}' | tr -d '[:space:]')
if [[ -z "${TUNNEL_ID}" ]]; then
  err "Could not extract tunnel ID from ${CONFIG_FILE}"
  exit 1
fi

log "Found tunnel ID: ${TUNNEL_ID}"

# ── Step 2: Find the credential JSON ────────────────────────────────────────
CRED_FILE="${CLOUDFLARED_DIR}/${TUNNEL_ID}.json"
if [[ ! -f "${CRED_FILE}" ]]; then
  err "Credential file not found: ${CRED_FILE}"
  err "Available files:"
  ls -1 "${CLOUDFLARED_DIR}"/*.json 2>/dev/null || err "  (none)"
  exit 1
fi

log "Using credential file: ${CRED_FILE}"

# ── Step 3: Base64-encode the credential JSON → tunnel token ────────────────
TUNNEL_TOKEN=$(base64 -w 0 < "${CRED_FILE}")
if [[ -z "${TUNNEL_TOKEN}" ]]; then
  err "Failed to base64-encode credential file"
  exit 1
fi

log "Generated CLOUDFLARE_TUNNEL_TOKEN (${#TUNNEL_TOKEN} chars)"

# ── Step 4: Write or print ──────────────────────────────────────────────────
if [[ "${DRY_RUN}" == "true" ]]; then
  log "[DRY-RUN] Would write CLOUDFLARE_TUNNEL_TOKEN to ${ENV_FILE}"
  exit 0
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  err "Target env file not found: ${ENV_FILE}"
  exit 1
fi

# Replace existing line or append
if grep -q '^CLOUDFLARE_TUNNEL_TOKEN=' "${ENV_FILE}"; then
  # Use a temp file for safe in-place edit
  TMPFILE=$(mktemp)
  trap 'rm -f "${TMPFILE}"' EXIT
  sed "s|^CLOUDFLARE_TUNNEL_TOKEN=.*|CLOUDFLARE_TUNNEL_TOKEN=${TUNNEL_TOKEN}|" \
    "${ENV_FILE}" > "${TMPFILE}"
  mv "${TMPFILE}" "${ENV_FILE}"
  log "Updated CLOUDFLARE_TUNNEL_TOKEN in ${ENV_FILE}"
else
  echo "CLOUDFLARE_TUNNEL_TOKEN=${TUNNEL_TOKEN}" >> "${ENV_FILE}"
  log "Appended CLOUDFLARE_TUNNEL_TOKEN to ${ENV_FILE}"
fi

log "Done. Restart cloudflared to apply: docker compose up -d --force-recreate cloudflared"
