#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# shellcheck disable=SC1091
source secrets/cloudflare.env

export TF_VAR_cf_account_id="${CLOUDFLARE_ACCOUNT_ID}"
export TF_VAR_cf_zone_id="${CLOUDFLARE_ZONE_ID}"
export TF_VAR_cf_dns_token="${CLOUDFLARE_DNS_TOKEN}"

printf '\nTerraform variables exported.\n'
