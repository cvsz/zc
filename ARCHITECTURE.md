# Architecture

## Current product boundaries

The canonical deployment is a local FastAPI origin published through
Cloudflare Tunnel and protected by Cloudflare Access. Application
authorization remains mandatory for mutating routes. The HTTP and gRPC
origins bind to loopback in the local-first profile.

```text
Browser / CLI
      |
Cloudflare Access + Tunnel
      |
app/ FastAPI on 127.0.0.1:8000
      |
local files + atomic JSON + local SQLite metadata
```

For public-local production requests, `cloudflared` and the FastAPI origin
both validate the Cloudflare Access assertion. The origin verifies the RS256
signature against the team JWKS, plus issuer, audience, expiry, issued-at, and
subject claims. Application JWT/RBAC and tenant checks remain a separate inner
authorization layer.

Upload chunks, resumable metadata, and assembled files remain on local disk.
Assembly publishes atomically into a tenant-scoped quarantine directory with
service-user-only permissions. No download route promotes quarantined content,
and non-local storage backends fail configuration validation.

The compatibility `/v1/files` multipart route follows the same trust boundary:
new files are recorded as `quarantined`, cannot be downloaded or sent to the
AI provider, and have no public promotion endpoint. A future local malware
scanner may mark a file `available` only through a separately reviewed trusted
service boundary.

Every authenticated mutating HTTP request crosses a durable local idempotency
boundary after Cloudflare Access validation and the request-size guard. Cache
keys are scoped to the verified application subject and tenant, HTTP route,
query string, and caller-provided `Idempotency-Key`. A reused key with a
different body is rejected, concurrent duplicates execute once, and bounded
response records survive a process restart.

The repository also retains the `zc-legacy` compatibility CLI under
`src/wire/`, a compatibility web adapter under `webapp/backend/`, and
development-only agent configuration. The bundled React frontend under
`webapp/frontend-src/` calls the supported API directly. Their ownership,
dependency direction, and migration gates are defined by
[ADR-001](docs/adr/ADR-001-product-surface-boundaries.md) and enforced by
tests.

## Legacy CLI architecture

wire is a single-process Python CLI that wraps the Anthropic Messages
API, plus a modular set of feature areas (one `zc_*.py` file per API
surface: files, batches, vision, RAG, agents, etc). `main.py` is the only
entrypoint; every feature is reachable as a CLI flag, there is no
long-running server component. Two of those modules —
`zc_admin_api.py` and `zc_compliance_api.py` — talk to
organization-level endpoints under different key types than the rest of
the CLI; see "Admin & Compliance APIs" below.

```
                         ┌─────────────┐
   CLI args ───────────► │   main.py   │  argparse dispatch, no business
                         │             │  logic of its own
                         └──────┬──────┘
                                │
              ┌─────────────────┼─────────────────────┐
              ▼                 ▼                      ▼
        ┌───────────┐   ┌──────────────┐      ┌────────────────┐
        │ coder.py  │   │ zc_*.py  │      │ projects.py /   │
        │ (core     │   │ (one file    │      │ artifacts.py /  │
        │  generate │   │  per API     │      │ personalities.py│
        │  call)    │   │  feature)    │      │ (local state)   │
        └─────┬─────┘   └──────┬───────┘      └────────┬────────┘
              │                │                        │
              └────────┬───────┴────────────────────────┘
                        ▼
              ┌───────────────────┐
              │  Cross-cutting     │
              │  infrastructure:   │
              │  resilience.py     │  retry + circuit breaker
              │  logging_config.py │  structured logs, redaction
              │  security.py       │  path/URL/input validation
              │  exceptions.py     │  typed error hierarchy
              └─────────┬──────────┘
                        ▼
              api.zc.com (HTTPS, urllib — no SDK
              dependency for the core path; the `zc`
              package is only required for the Managed
              Agents beta client)

              Most modules hit /v1/messages (or /v1/files,
              /v1/batches, ...) with a regular API key.
              zc_admin_api.py hits /v1/organizations/*
              and zc_compliance_api.py hits /v1/compliance/*
              — both need an Admin API key (sk-ant-admin01-...)
              or, for the Compliance module, a Compliance
              Access Key (sk-ant-api01-... with compliance
              scopes) instead of the regular API key everything
              else uses.
```

## Cross-cutting infrastructure

These four modules exist so every feature module gets the same behavior
for free instead of re-implementing it:

- **`exceptions.py`** — every deliberate error is an `AICoderError`
  subclass with a stable `error_code` and a `RETRYABLE` flag. This is the
  contract `resilience.retry()` reads to decide what to retry.
- **`resilience.py`** — `retry()` (exponential backoff with full jitter)
  and `CircuitBreaker` (fail-fast during an outage), plus
  `raise_for_http_error()` / `urlopen_json()` / `urlopen_text()`, shared
  helpers that translate a raw `urllib` HTTP/network exception into the
  `AICoderError` hierarchy `retry()` reads. wired into every module that
  makes direct HTTP calls (`coder.py`, `zc_files.py`,
  `zc_tools.py`, `zc_code.py`, `zc_models.py`, and 15 others
  — one `CircuitBreaker` per module/downstream, since a GitHub outage
  shouldn't trip the breaker that guards Anthropic API calls, or vice
  versa). Two exceptions by design: `zc_batch.py` and
  `zc_rag.py` call through the `anthropic` SDK client, which retries
  internally, so there's nothing to wire. A handful of call sites that
  fetch an arbitrary caller-supplied URL rather than one fixed dependency
  (`zc_chrome.py`'s page fetch, `zc_research.py`'s source fetch,
  `zc_code.py`'s `WebFetch` tool, `zc_plugins.py`'s marketplace
  fetch) use `retry()` without a `CircuitBreaker`, since a breaker keyed
  on "this one dependency is down" doesn't mean anything when every call
  targets a different host.
- **`logging_config.py`** — one structured logger per module via
  `get_logger(__name__)`, a correlation ID set once per CLI invocation,
  and automatic secret redaction on every log record regardless of what
  gets passed to `logger.info(...)`.
- **`security.py`** — path traversal guards, name/URL/size validation.
  Anything that turns user input into a filesystem path or outbound
  request should go through here rather than string-concatenating paths
  directly.

## Admin & Compliance APIs — a deliberately separate contract

`zc_admin_api.py` and `zc_compliance_api.py` don't route through
`coder.py` or `resilience.py`. They're org-level surfaces, not model
calls, and each has its own documented retry contract (429 + retryable
5xx back off exponentially; 400/401/403/404/409 never retry) implemented
directly in the module rather than reusing `resilience.retry()` — the
two contracts happen to look similar but are specified independently in
ZaiCoder's docs, so keeping them separate avoids a false coupling if
one changes later.

Key model, since it's easy to get wrong and the failure mode is a 403,
not a crash:
- A regular API key (`sk-ant-api03-...`) — everything else in this CLI
  — cannot call either module.
- An **Admin API key** (`sk-ant-admin01-...`) unlocks all of
  `zc_admin_api.py`, plus *only* the Activity Feed endpoint
  (`--compliance-activities`) in `zc_compliance_api.py`.
- A **Compliance Access Key** (`sk-ant-api01-...`, created in zc.ai
  with specific scopes at creation time — scopes are immutable
  afterward) unlocks the rest of `zc_compliance_api.py`: reading or
  hard-deleting chats, files, and projects, plus directory endpoints.
  It cannot call `zc_admin_api.py`.

`zc_compliance_api.py`'s destructive operations (chat/file/project
hard-delete) are permanent with no recovery window, so every `cmd_*` that
deletes something is dry-run unless the caller passes `yes=True`
(`--compliance-yes` on the CLI) — the same opt-in-execution pattern
`zc_models.py` uses for `--upgrade-all`/`--upgrade-yes`, rather than
a new confirmation convention. Pagination in both modules only advances
its cursor after a page is *successfully* fetched, so a failed request
never silently skips data on retry.

## Why `generate()` still returns strings on error

`Coder.generate()` returns `"[ERROR] ..."` / `"[API ERROR 429] ..."` /
`"[REFUSED] ..."` strings rather than raising, even though the new
internals (`exceptions.py`) are exception-based. This preserves the
existing contract every call site in `main.py` and the `zc_*.py`
modules already depends on (`result = c.generate(...); print(result)`).
Internally, the network call raises typed exceptions so retry/circuit-
breaking/logging can key off `error_code` and `RETRYABLE`; they're caught
and converted back to the legacy string format at the boundary. A future
major version could flip this to raise-by-default with a
`generate(..., raise_on_error=True)` opt-in during the transition.

## State & persistence

The supported `app/` runtime stores operational state under configured local
state directories rather than hosted services. Upload sessions and chat
sessions use tenant-scoped atomic JSON files. Domain resources use local
SQLite with optimistic concurrency, and idempotency records are persisted on
local disk so retried mutating requests can replay safely after a process
restart. Production paths are expected to live under `/var/lib/zc`; local
development defaults use `./data/`.

The `zc-legacy` compatibility CLI under `src/wire/` still keeps its historical
state in flat JSON files under the user's home directory, including
`~/.ai-coder-config.json` and `~/.ai-coder/`. That legacy storage model does
not define the canonical public-local server persistence contract.

## Packaging

Two ways to run this:
1. **From source**: `setup.sh`/`setup.bat` create a venv and `.env`.
2. **Standalone binary**: `build.sh`/`build.bat` + `ai-coder.spec` produce
   a PyInstaller single-file executable with no local Python required.
3. **Container**: `Dockerfile` (multi-stage, non-root, healthcheck) +
   `docker-compose.yml` for anything that wants to run this as a service
   dependency rather than a local CLI. See `docs/deployment.md`.
