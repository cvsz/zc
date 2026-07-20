#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

: "${CLOUDFLARE_API_TOKEN:?Missing CLOUDFLARE_API_TOKEN}"

readonly TARGET_DOMAIN="zeaz.dev"

response="$(
  curl -sS \
    "https://api.cloudflare.com/client/v4/zones?page=1&per_page=100" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
)"

success="$(echo "${response}" | jq -r '.success')"

if [[ "${success}" != "true" ]]; then
  echo "${response}" | jq
  exit 1
fi

CLOUDFLARE_ZONE_ID="$(
  echo "${response}" \
    | jq -r \
      --arg DOMAIN "${TARGET_DOMAIN}" '
        .result[]
        | select(.name == $DOMAIN)
        | .id
      '
)"

if [[ -z "${CLOUDFLARE_ZONE_ID}" || "${CLOUDFLARE_ZONE_ID}" == "null" ]]; then
  echo "Zone not found"
  exit 1
fi

printf '\nZone: %s\n' "${TARGET_DOMAIN}"
printf 'Zone ID: %s\n' "${CLOUDFLARE_ZONE_ID}"
