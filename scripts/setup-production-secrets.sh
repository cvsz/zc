#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_NAME="${0##*/}"

repo="${GITHUB_REPOSITORY:-cvsz/zc}"
environment="${GITHUB_ENVIRONMENT:-staging}"
env_file="${ENV_FILE:-.env}"
dry_run=false

usage() {
  cat <<USAGE
Usage: ${SCRIPT_NAME} [options]

Upload every entry in a dotenv file to a GitHub Actions environment.

Options:
  --repo OWNER/REPO       Target repository (default: ${repo})
  --environment NAME      GitHub environment (default: ${environment})
  --env-file PATH         Dotenv file to upload (default: ${env_file})
  --dry-run               Validate and list secret names without uploading
  -h, --help              Show this help

Environment variables:
  GITHUB_REPOSITORY       Default repository
  GITHUB_ENVIRONMENT      Default GitHub environment
  ENV_FILE                Default dotenv file
USAGE
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

require_value() {
  local option="$1"
  local value="${2:-}"
  [[ -n "$value" ]] || die "${option} requires a value"
}

while (($# > 0)); do
  case "$1" in
    --repo)
      require_value "$1" "${2:-}"
      repo="$2"
      shift 2
      ;;
    --environment)
      require_value "$1" "${2:-}"
      environment="$2"
      shift 2
      ;;
    --env-file)
      require_value "$1" "${2:-}"
      env_file="$2"
      shift 2
      ;;
    --dry-run)
      dry_run=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] \
  || die "repository must use OWNER/REPO format"
[[ "$environment" =~ ^[A-Za-z0-9_.-]+$ ]] \
  || die "environment contains unsupported characters"
[[ -f "$env_file" ]] || die "dotenv file not found: ${env_file}"
[[ ! -L "$env_file" ]] || die "refusing to read a symbolic-link dotenv file"
command -v gh >/dev/null 2>&1 || die "GitHub CLI (gh) is required"

mapfile -t secret_names < <(
  sed -nE 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=.*/\2/p' "$env_file"
)

((${#secret_names[@]} > 0)) || die "dotenv file contains no assignments"

printf 'Repository: %s\n' "$repo"
printf 'Environment: %s\n' "$environment"
printf 'Dotenv file: %s\n' "$env_file"
printf 'Secrets: %d\n' "${#secret_names[@]}"

if [[ "$dry_run" == true ]]; then
  printf '%s\n' "${secret_names[@]}"
  printf 'Dry run complete; no GitHub resources were changed.\n'
  exit 0
fi

gh auth status >/dev/null
gh secret set \
  --repo "$repo" \
  --env "$environment" \
  --env-file "$env_file"

printf 'Uploaded %d secrets to GitHub environment %s.\n' \
  "${#secret_names[@]}" "$environment"
