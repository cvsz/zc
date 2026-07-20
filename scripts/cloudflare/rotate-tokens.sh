#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

readonly TOKENS_FILE="./secrets/cloudflare.env"
readonly BACKUP_DIR="./backups/tokens"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR

log() {
  printf '\n[%s] %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*"
}

rollback() {
  local backup_file="$1"
  if [[ -f "${backup_file}" ]]; then
    cp "${backup_file}" "${TOKENS_FILE}"
    log "Rollback completed from ${backup_file}"
  fi
}

main() {
  mkdir -p "${BACKUP_DIR}"
  local timestamp backup_file
  timestamp="$(date -u +"%Y%m%dT%H%M%SZ")"
  backup_file="${BACKUP_DIR}/cloudflare.env.${timestamp}"

  if [[ -f "${TOKENS_FILE}" ]]; then
    cp "${TOKENS_FILE}" "${backup_file}"
    log "Backup created: ${backup_file}"
  fi

  if ! "${SCRIPT_DIR}/generate-tokens.sh"; then
    log "Token generation failed; starting rollback"
    rollback "${backup_file}"
    exit 1
  fi

  # shellcheck disable=SC1090
  source "${TOKENS_FILE}"

  local required=(CLOUDFLARE_API_TOKEN CLOUDFLARE_DNS_TOKEN CLOUDFLARE_ZT_TOKEN CLOUDFLARE_WORKERS_TOKEN CLOUDFLARE_PAGES_TOKEN CLOUDFLARE_WAF_TOKEN CLOUDFLARE_TUNNEL_TOKEN CLOUDFLARE_R2_TOKEN CLOUDFLARE_D1_TOKEN CLOUDFLARE_AUDIT_TOKEN CLOUDFLARE_AI_GATEWAY_TOKEN)
  local key
  for key in "${required[@]}"; do
    if [[ -z "${!key:-}" ]]; then
      log "Missing token after rotation: ${key}; rolling back"
      rollback "${backup_file}"
      exit 1
    fi
  done

  log "Token rotation complete"
}

main "$@"
