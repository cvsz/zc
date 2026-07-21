#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TF_DIR="${ROOT_DIR}/infra/cloudflare"

required_files=(
  versions.tf
  providers.tf
  variables.tf
  main.tf
  outputs.tf
  terraform.tfvars.example
  .terraform.lock.hcl
  README.md
)

for relative_path in "${required_files[@]}"; do
  path="${TF_DIR}/${relative_path}"
  [[ -f "$path" ]] || {
    echo "ERROR: missing canonical Terraform file: ${path}" >&2
    exit 1
  }
done

if grep -RIn \
  'zai\.zeaz\.dev\|api\.zeaz\.dev\|variable "zc_api_domain"' \
  "${TF_DIR}" \
  --include='*.tf' \
  --include='*.md' \
  --include='*.example'; then
  echo "ERROR: retired dual-host Cloudflare contract detected" >&2
  exit 1
fi

terraform -chdir="$TF_DIR" fmt -check -recursive
terraform -chdir="$TF_DIR" init -backend=false -lockfile=readonly
terraform -chdir="$TF_DIR" validate

bash "${ROOT_DIR}/scripts/cloudflare/check-cloudflare-config.sh"

echo "PASS: canonical zeaz.dev Terraform and ingress contract validated"
echo "No Cloudflare changes were made."
