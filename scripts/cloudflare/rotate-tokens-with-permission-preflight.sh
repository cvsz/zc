#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/env-scope.sh"
cf_load_cloudflare_env_scope
cd "$PROJECT_ROOT"

CACHE_DIR="${CACHE_DIR:-./.cache/cloudflare-permissions}"
REFRESH=false
OFFLINE=false

log(){ cf_env_log "$*"; }
warn(){ cf_env_warn "$*"; }
die(){ cf_env_die "$*"; }

contains_arg(){
  local wanted="$1"; shift
  local arg
  for arg in "$@"; do [[ "$arg" == "$wanted" ]] && return 0; done
  return 1
}

for arg in "$@"; do
  [[ "$arg" == "--refresh-permissions" ]] && REFRESH=true
  [[ "$arg" == "--offline" ]] && OFFLINE=true
done

if ! contains_arg --regenerate "$@"; then
  exec bash scripts/cloudflare/run-token-rotation.sh "$@"
fi

command -v jq >/dev/null 2>&1 || die "jq is required"
if $OFFLINE; then
  cf_require_env CLOUDFLARE_ACCOUNT_ID || exit 1
else
  cf_require_env CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_BOOTSTRAP_TOKEN || exit 1
fi

cache="$CACHE_DIR/account-token-permission-groups.${CLOUDFLARE_ACCOUNT_ID}.json"
mkdir -p "$CACHE_DIR"

if $OFFLINE; then
  if [[ ! -s "$cache" ]]; then
    warn "offline preflight: no cached permission-group data at $cache"
    printf '{"success":true,"result":[]}\n' > "$cache"
  fi
  log "offline preflight: using cached permission-group data"
else
  command -v curl >/dev/null 2>&1 || die "curl is required"
  log "Running discover-permission-groups.sh preflight check..."
  opts=()
  $REFRESH && opts+=(--refresh)
  bash "$SCRIPT_DIR/discover-permission-groups.sh" "${opts[@]}" >/dev/null || die "Permission-group discovery preflight failed."
  [[ -f "$cache" ]] || die "Preflight completed but cache file not found at $cache"
fi

pick_permission(){
  local kind="$1"
  jq -r --arg kind "$kind" '
    def txt: ([.name // "", .description // "", .scope // "", (.scopes // [] | tostring), (.resource_groups // [] | tostring)] | join(" "));
    def has($re): (txt | test($re));
    def score($k):
      if $k == "dns" then
        if has("(?i)^DNS Write$") then 0
        elif has("(?i)^DNS View Write$") then 1
        elif has("(?i)dns.*(write|edit)") and (has("(?i)settings") | not) and (has("(?i)(dns firewall|account)") | not) then 10
        else 999 end
      elif $k == "zt" then
        if has("(?i)^Access: Apps and Policies Write$") then 0
        elif has("(?i)(Zero Trust|Access:).*(write|edit)") and (has("(?i)(Report|Read|PII|Resilience|Seats)") | not) then 1
        else 999 end
      elif $k == "tunnel" then if has("(?i)^Cloudflare Tunnel Write$") then 0 else 999 end
      else 999 end;
    (.result // [])
    | map(. + {__score: score($kind)})
    | map(select(.__score < 999))
    | sort_by(.__score, .name)
    | .[0].id // empty
  ' "$cache"
}

export_if_missing(){
  local key="$1" val="$2" label="$3"
  if [[ -z "${!key:-}" && -n "$val" ]]; then
    export "$key=$val"
    log "resolved $label permission-group override: $val"
  elif [[ -n "${!key:-}" ]]; then
    log "using existing $key override"
  else
    warn "could not resolve $label permission-group override"
  fi
}

export_if_missing CLOUDFLARE_DNS_PERMISSION_GROUP_ID "$(pick_permission dns)" dns
export_if_missing CLOUDFLARE_ZT_PERMISSION_GROUP_ID "$(pick_permission zt)" zt
export_if_missing CLOUDFLARE_TUNNEL_PERMISSION_GROUP_ID "$(pick_permission tunnel)" tunnel

exec bash scripts/cloudflare/run-token-rotation.sh "$@"
