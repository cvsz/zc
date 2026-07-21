# Repository Architecture Audit — 2026-07-20

## Scope

This report records the current repository evidence for the canonical
local-first `zcoder` runtime. It covers source wiring, persistence, packaging,
the bundled frontend, container execution, native Ubuntu services, CI,
release automation, and Terraform configuration. Historical upgrade and
enterprise phase reports are point-in-time records and are not runtime proof.

No Cloudflare resources were created or changed during this audit. No release,
image, commit, or Git branch was published.

## Canonical contract

| Concern | Current contract |
|---|---|
| Public hostname | `https://zeaz.dev` |
| Origin | FastAPI on `127.0.0.1:8000` |
| Edge | Cloudflare Access and remotely managed Tunnel |
| Application authorization | Short-lived JWT, RBAC, and tenant checks |
| AI routing | Embedded LiteLLM Router; no separate proxy |
| Storage | Local filesystem, atomic JSON, and local SQLite |
| Upload publication | Tenant-scoped quarantine only |
| gRPC | Disabled in the public profile; loopback-only when enabled |
| Optional services | Redis and gRPC disabled by default; local logs only |
| Production workers | Exactly one |

## Verified repository evidence

- Production configuration fails closed unless authentication, Cloudflare
  Access verification, exact `https://zeaz.dev` CORS, rate limiting, strict
  readiness, persistent encryption material, and provider credentials are
  configured. Unknown environment names are rejected, the production provider
  must be embedded LiteLLM, and enabled gRPC can bind only to loopback with a
  valid adjacent port. Canonical application identity and version cannot be
  spoofed through environment overrides, and executable tests require both
  environment examples to cover every runtime-owned setting.
- Cloudflare Access assertions are verified at the origin against the team
  JWKS with RS256, issuer, audience, expiry, issued-at, and subject checks.
  JWKS fetches reject redirects, nonstandard team origins, and response bodies
  larger than 256 KiB before buffering them in full.
- Mutating routes require application authentication and durable
  idempotency keys. Operational compatibility health routes require
  application roles; only canonical local probes bypass origin Access.
  Durable replay namespaces include the verified subject, tenant, and complete
  application-role set, so a lower-privilege token cannot replay a response
  produced under a higher-privilege token.
- Upload state survives restart through atomic session metadata. Chunk and
  final BLAKE3 digests, tenant ownership, size limits, free-space reservation,
  symlink safety, quarantine publication, cleanup, and directory permissions
  are enforced. Raw and multipart chunk ingestion resolves the session before
  consuming file data and applies the exact expected chunk-size budget while
  streaming.
- Chat JSON writes are atomic and stale writes are rejected. SQLite resource
  updates use optimistic concurrency so concurrent requests cannot silently
  overwrite newer nested state.
- File blobs use exclusive no-follow creation, mode `0600`, fsync, tenant
  directories with mode `0700`, and no-follow reads. Multipart files remain
  quarantined and unavailable to downloads or AI context until a trusted
  local scanner marks them available; no public promotion route exists.
- Managed worker environments, schedules, webhook delivery, and vault-backed
  execution fail closed with HTTP 501 because the standalone runtime has no
  dispatcher or worker for them. The API does not create misleading active
  resources for unavailable capabilities. Iterative outcome evaluation and
  chat-session dream inputs fail closed for the same reason; archived memory
  stores cannot be used for new execution.
- The Docker image runs as an unprivileged user and starts the validated
  application CLI. Native systemd units use separate `zc` and `cloudflared`
  users with hardened service settings.
- Optional Redis/Valkey is restricted to a loopback URL in production. Its
  circuit breaker has explicit closed, open, and single-probe half-open
  behavior; authenticated health output redacts connection failures, and
  Redis-backed rate limiting returns a sanitized 503 instead of falling open.
- Unwired mock RBAC, latency-profiler, and OpenTelemetry exporter modules were
  removed from the supported core. Request duration remains real structured
  log data; gRPC reports measured transfer and delta timing without synthetic
  latency percentiles.
- Terraform uses the Cloudflare provider v5 contract, creates Access before
  routing, requires explicit user and service-token policies, routes only to
  loopback, requires Access at cloudflared, and terminates ingress with 404.
- CI checks formatting, lint, typing, tests, the frontend, package contents,
  all executable Python surfaces with Bandit, repository secrets with
  Gitleaks, and a production-profile container smoke test.
- Release automation validates the source version against an existing tag,
  smoke-tests the production image before publication, publishes a
  versioned image with SBOM and provenance, records its digest, and attaches
  the built wheel to the GitHub release.

## Verification commands

The local completion gate is:

```bash
pytest -q
ruff check app tests
ruff format --check app tests
mypy app
bandit -q -c pyproject.toml -r app src/wire webapp/backend
gitleaks detect --no-banner --redact
npm --prefix webapp/frontend-src test -- --run
npm --prefix webapp/frontend-src run typecheck
npm --prefix webapp/frontend-src run build
npm --prefix webapp/frontend-src audit --audit-level=moderate
terraform -chdir=infra/cloudflare fmt -check -recursive
terraform -chdir=infra/cloudflare init -backend=false
terraform -chdir=infra/cloudflare validate
make requirements-lock-check
make package-wheel
git diff --check
```

Container verification must additionally start the image with the complete
production environment, verify `/ready`, verify an unauthenticated request is
denied, and reject warning or traceback output.

## Evidence not available locally

The following remain unverified until an operator supplies real account state
and explicitly approves external changes:

- Terraform plan against the real Cloudflare account and zone;
- Terraform apply, DNS, Tunnel, and Access policy state;
- real Access denial and allow flows through `https://zeaz.dev`;
- LAN verification that ports 8000 and 8001 are unreachable;
- tunnel-path latency, throughput, and upload-limit benchmarks;
- offline backup restoration on an isolated host.

These are operational gates, not claims established by repository tests.

## Current host observation

Read-only inspection on 2026-07-20 found that the repository deployment units
are not installed: `zc.service` and `cloudflared-zc.service` are absent, no
process listens on ports 8000 or 8001, and `/etc/zc/zc.env` plus the dedicated
cloudflared token file do not exist.

The host instead runs a pre-existing `cloudflared.service` for the
`zeaz-platform` tunnel as the interactive `zeazdev` user. Its local ingress
maps `zeaz.dev` to `127.0.0.1:3003`, contains a wildcard hostname, and ends in
HTTP 418. This conflicts with the canonical zc contract of a separate service
user, `127.0.0.1:8000`, explicit Access protection, and a final HTTP 404 rule.
An unauthenticated public request returned HTTP 404 from Cloudflare, which does
not prove an Access deny flow.

All configured Cloudflare API-token variants returned HTTP 401 during
read-only DNS, Tunnel, and Access queries. No token was rotated and no account
resource was changed. The current account state therefore remains unverified,
and Terraform planning/import must not proceed until an operator supplies a
working scoped token plus explicit Access identities and service-token IDs.

## Repository hygiene

`.web-venv/` previously contributed 11,862 generated files and approximately
498 MiB to the Git index. It is now removed from the index and remains ignored;
the operator's local environment is preserved on disk. A quality-policy test
prevents `.venv/` or `.web-venv/` content from being tracked again.

The stale `mypy_errors.txt` report is removed in the current worktree. It
described retired modules rather than the current type-check result and is now
covered by an ignore rule for local reports. The deletion still needs to be
included in the final repository change set before claiming the tracked index
is clean.

## Continuation audit — 2026-07-21

The current structure is repo-complete for the canonical local-first
application boundary, but not operationally complete for public production.
The strongest local evidence is executable: targeted contract tests pass for
runtime configuration, Cloudflare Access verification, Terraform structure,
product boundaries, quality policy, and upload durability. Terraform validates
locally against the checked-in provider lock and the Cloudflare configuration
still routes one same-origin hostname to `http://127.0.0.1:8000` with Access
required and a final `http_status:404` ingress rule.

The native preflight source units also pass `systemd-analyze verify`. The
preflight script now treats an unqueryable systemd manager as unknown evidence
instead of reporting that services are absent or inactive. This matters in
sandboxed or non-systemd contexts where `systemctl` exists but cannot connect
to the host bus.

Current read-only host evidence still does not prove public-local deployment:
no listener is active on ports 8000 or 8001, `zc.service` and
`cloudflared-zc.service` cannot be verified from this context, the production
environment and tunnel token files are not installed, and the observed
cloudflared process belongs to an existing `zeaz-platform` tunnel rather than
the canonical zc tunnel. Those are operator/external gates, not repository
implementation gaps.
