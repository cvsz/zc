#!/usr/bin/env bash
set -Eeuo pipefail

source "$(dirname "$0")/permissions.sh"

cf_api GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/tokens/permission_groups" |
  jq -r '.result[] | [.name, .id] | @tsv'
