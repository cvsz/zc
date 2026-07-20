#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

TARGET="scripts/cloudflare/rotate-tokens-with-permission-preflight.sh"
DEFAULT_OUT=".env.cloudflare"

notice(){
  local global_key_label="Global API"" Key"
  cat >&2 <<NOTICE
[deprecated] scripts/cloudflare/gen-token.sh is a compatibility wrapper.
[deprecated] ${global_key_label} auth is disabled.
[deprecated] Use CLOUDFLARE_BOOTSTRAP_TOKEN account-token flow.
[deprecated] Forwarding to ${TARGET}
NOTICE
}

usage(){
  cat <<USAGE
Deprecated compatibility wrapper.

Use Make targets:
  make token-verify
  make token-rotate-dry
  make token-rotate

Direct modern command:
  bash ${TARGET} --dry-run --regenerate --types all --backup --write ${DEFAULT_OUT} --refresh-permissions

Supported compatibility args:
  --dry-run
  --yes
  --backup
  --types <csv|all>
  --write <file>
  --perm-id <id>
  --refresh-permissions
  --help

Ignored legacy args:
  --force
  --revoke-old
  --clean
USAGE
}

contains_arg(){
  local wanted="$1"; shift
  local arg
  for arg in "$@"; do
    [[ "$arg" == "$wanted" ]] && return 0
  done
  return 1
}

args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --types|--write|--perm-id)
      [[ -n "${2:-}" ]] || { echo "ERROR: $1 requires a value" >&2; exit 2; }
      args+=("$1" "$2")
      shift 2
      ;;
    --dry-run|--yes|--backup|--refresh-permissions)
      args+=("$1")
      shift
      ;;
    --force|--revoke-old|--clean)
      echo "[deprecated] ignoring legacy option: $1" >&2
      shift
      ;;
    --help|-h)
      notice
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

notice

if ! contains_arg --regenerate "${args[@]}"; then
  args=(--regenerate "${args[@]}")
fi
if ! contains_arg --types "${args[@]}"; then
  args+=(--types all)
fi
if ! contains_arg --backup "${args[@]}"; then
  args+=(--backup)
fi
if ! contains_arg --write "${args[@]}"; then
  args+=(--write "$DEFAULT_OUT")
fi
if ! contains_arg --refresh-permissions "${args[@]}"; then
  args+=(--refresh-permissions)
fi

exec bash "$TARGET" "${args[@]}"
