#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

cat <<'NOTICE'
[deprecated] This installer is obsolete.
[deprecated] Cloudflare token lifecycle is already handled by the modern account-token flow.

Use:
  make token-verify
  make token-rotate-dry
  make token-rotate

Direct command:
  bash scripts/cloudflare/rotate-tokens-with-permission-preflight.sh \
    --dry-run \
    --regenerate \
    --types all \
    --backup \
    --write .env.cloudflare \
    --refresh-permissions

No files were modified.
NOTICE

exit 0
