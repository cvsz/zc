#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROLLBACK_OUT="${ROOT_DIR}/docs/reports/generated/zc-rollback-plan.md"

mkdir -p "${ROOT_DIR}/docs/reports/generated"

cat >"$ROLLBACK_OUT" <<'EOF'
# zeaz.dev rollback plan

## Checklist

- Disable the affected route.
- Restore the previous DNS target.
- Lock the Access policy to private-admin-only.
- Verify ssh.zeaz.dev is unchanged.

## Commands

Dry-run only:

```bash
make zc-rollback-plan
```

Live rollback requires:

```bash
APPLY=true CONFIRM_ROLLBACK=yes make zc-rollback-plan
```

EOF

if [[ "${APPLY:-false}" != "true" || "${CONFIRM_ROLLBACK:-no}" != "yes" ]]; then
  echo "Rollback plan written to ${ROLLBACK_OUT}"
  echo "No rollback was applied."
  exit 0
fi

echo "Rollback apply requested, but this repository only emits the operator checklist."
echo "Execute provider-specific rollback commands after reviewing ${ROLLBACK_OUT}"
