#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-cvsz/z-platform}"
ENV_FILE="${ENV_FILE:-.env}"
if (($#)); then
  TARGET_ENVIRONMENTS=("$@")
else
  TARGET_ENVIRONMENTS=(staging production)
fi

read_env_value() {
  local key="$1"
  python - "$ENV_FILE" "$key" <<'PY'
from pathlib import Path
import sys

env_path = Path(sys.argv[1])
target_key = sys.argv[2]

if not env_path.exists():
    raise SystemExit(1)

for raw_line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#"):
        continue
    if line.startswith("export "):
        line = line[7:].lstrip()
    if "=" not in line:
        continue
    key, value = line.split("=", 1)
    if key.strip() != target_key:
        continue
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        value = value[1:-1]
    sys.stdout.write(value)
    raise SystemExit(0)

raise SystemExit(1)
PY
}

set_secret() {
  local environment="$1"
  local secret_name="$2"
  local secret_value="$3"

  printf '%s' "$secret_value" | env -u GITHUB_TOKEN gh secret set "$secret_name" \
    --repo "$REPO" \
    --env "$environment" >/dev/null
}

for environment in "${TARGET_ENVIRONMENTS[@]}"; do
  nvidia_key="$(read_env_value NVIDIA_NIM_API_KEY)"
  gemini_key="$(read_env_value GEMINI_API_KEY)"

  if [[ -z "$nvidia_key" || -z "$gemini_key" ]]; then
    echo "Missing NVIDIA_NIM_API_KEY or GEMINI_API_KEY in $ENV_FILE" >&2
    exit 1
  fi

  set_secret "$environment" NVIDIA_NIM_API_KEY "$nvidia_key"
  set_secret "$environment" GEMINI_API_KEY "$gemini_key"

  echo "Updated NVIDIA_NIM_API_KEY and GEMINI_API_KEY in $environment"
done
