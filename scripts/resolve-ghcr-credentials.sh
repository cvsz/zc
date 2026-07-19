#!/usr/bin/env sh
set -eu

fail() {
  printf 'GHCR credential resolution failed: %s\n' "$1" >&2
  exit 1
}

pair_state() {
  username=${1:-}
  token=${2:-}
  if [ -n "$username" ] && [ -n "$token" ]; then
    printf 'complete'
  elif [ -z "$username" ] && [ -z "$token" ]; then
    printf 'empty'
  else
    printf 'partial'
  fi
}

legacy_state=$(pair_state "${GHCR_USERNAME:-}" "${GHCR_PULL_TOKEN:-}")
oauth_state=$(pair_state "${GHCR_OAUTH_ID:-}" "${GHCR_OAUTH_TOKEN:-}")

if [ "$legacy_state" = partial ]; then
  fail 'GHCR_USERNAME and GHCR_PULL_TOKEN must be provided together'
fi

if [ "$oauth_state" = partial ]; then
  fail 'GHCR_OAUTH_ID and GHCR_OAUTH_TOKEN must be provided together'
fi

if [ "$legacy_state" = complete ]; then
  effective_username=$GHCR_USERNAME
  effective_token=$GHCR_PULL_TOKEN
  source_name=legacy
elif [ "$oauth_state" = complete ]; then
  effective_username=$GHCR_OAUTH_ID
  effective_token=$GHCR_OAUTH_TOKEN
  source_name=oauth
else
  fail 'provide either the legacy or OAuth credential pair'
fi

clean_username=$(printf '%s' "$effective_username" | tr -d '\n\r')
if [ "$clean_username" != "$effective_username" ]; then
  fail 'username contains a line break'
fi

clean_token=$(printf '%s' "$effective_token" | tr -d '\n\r')
if [ "$clean_token" != "$effective_token" ]; then
  fail 'token contains a line break'
fi

if [ -z "${GITHUB_ENV:-}" ]; then
  fail 'GITHUB_ENV is required'
fi

{
  printf 'GHCR_EFFECTIVE_USERNAME=%s\n' "$effective_username"
  printf 'GHCR_EFFECTIVE_TOKEN=%s\n' "$effective_token"
  printf 'GHCR_CREDENTIAL_SOURCE=%s\n' "$source_name"
} >> "$GITHUB_ENV"
