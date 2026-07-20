#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

cat <<'NOTICE'
[deprecated] scripts/cloudflare/apply-zero-global-key-patch.sh is no longer needed.
[deprecated] Legacy Cloudflare email/key authentication is disabled.
[deprecated] Token generation is already routed through the account-token flow.

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
