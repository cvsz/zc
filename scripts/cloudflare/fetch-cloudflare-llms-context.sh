#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT="${PROJECT_ROOT:-}"
if [[ -z "$ROOT" ]]; then
  ROOT="$PWD"
  while [[ "$ROOT" != "/" ]]; do
    if [[ -d "$ROOT/.git" || -f "$ROOT/.env.example" || -d "$ROOT/scripts" ]]; then
      break
    fi
    ROOT="$(dirname "$ROOT")"
  done
fi

[[ "$ROOT" != "/" ]] || ROOT="$PWD"

CACHE_DIR="${CLOUDFLARE_DOCS_CACHE_DIR:-$ROOT/.cache/cloudflare-docs}"
mkdir -p "$CACHE_DIR"

has(){ command -v "$1" >/dev/null 2>&1; }
log(){ printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
warn(){ log "WARN: $*" >&2; }
die(){ log "ERROR: $*" >&2; exit 1; }

has curl || die "curl is required"

fetch_text(){
  local url="$1" out="$2"
  local tmp
  tmp="$(mktemp "$CACHE_DIR/.fetch.XXXXXX")"

  if curl -fsSL --retry 3 --retry-delay 2 \
    -H 'Accept: text/plain, text/markdown;q=0.9, */*;q=0.1' \
    "$url" -o "$tmp"; then
    if [[ -s "$tmp" ]]; then
      mv "$tmp" "$out"
      chmod 600 "$out" 2>/dev/null || true
      log "cached $url -> $out"
      return 0
    fi
    warn "empty response from $url"
  else
    warn "failed to fetch $url"
  fi

  rm -f "$tmp"
  return 1
}

DEV_LLMS_URL="${DEV_LLMS_URL:-https://developers.cloudflare.com/llms.txt}"
FUNDAMENTALS_LLMS_URL="${FUNDAMENTALS_LLMS_URL:-https://developers.cloudflare.com/fundamentals/llms.txt}"
FUNDAMENTALS_FULL_URL="${FUNDAMENTALS_FULL_URL:-https://developers.cloudflare.com/fundamentals/llms-full.txt}"

fetch_text "$DEV_LLMS_URL" "$CACHE_DIR/developers-llms.txt"
fetch_text "$FUNDAMENTALS_LLMS_URL" "$CACHE_DIR/fundamentals-llms.txt"

if ! fetch_text "$FUNDAMENTALS_FULL_URL" "$CACHE_DIR/fundamentals-llms-full.txt"; then
  warn "fundamentals llms-full corpus unavailable; use fundamentals-llms.txt index and fetch specific Markdown pages"
fi

cat > "$CACHE_DIR/metadata.json" <<META
{
  "generated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "developers_llms_url": "$DEV_LLMS_URL",
  "fundamentals_llms_url": "$FUNDAMENTALS_LLMS_URL",
  "fundamentals_full_url": "$FUNDAMENTALS_FULL_URL"
}
META
chmod 600 "$CACHE_DIR/metadata.json" 2>/dev/null || true

log "Cloudflare docs cache ready: $CACHE_DIR"
