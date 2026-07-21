# zcoder

`zcoder` 1.33.0 is a Python 3.11+ repository containing a FastAPI API service, installed `zc`/`zcoder` server commands, web components, tests, container packaging, and additional agent and enterprise integration modules.

Historical modules and documents may still use the legacy names `wire` or `wire-enterprise`. The canonical distribution and runtime identity for the supported API surface is `zcoder`; existing `/v1/wire` routes remain unchanged for backward compatibility.

## Verified runtime contract

- Distribution: `zcoder==1.33.0`
- Console aliases: `zc`, `zcoder`
- FastAPI application: `app.main:app`
- Default HTTP port: `8000`
- Readiness: `GET /ready`
- Liveness: `GET /v1/wire/health/live`
- Supported Python: 3.11 and 3.12
- Container user: non-root
- CI: Ruff formatting/lint, mypy, Bandit across every executable Python surface, Gitleaks, package-install smoke tests, pytest, CodeQL, and production-profile Docker smoke tests

Historical phase-completion reports and benchmark tables are point-in-time records. Reproduce benchmarks before using numerical performance claims for sizing or service-level objectives.

## Quick start

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install .
cp .env.example .env
zc --host 127.0.0.1 --port 8000 --workers 1
```

Verify the service:

```bash
curl -fsS http://127.0.0.1:8000/ready
curl -fsS http://127.0.0.1:8000/v1/wire/health/live
```

Open `http://127.0.0.1:8000/` for the bundled local-first web workspace.
The UI, API, embedded LiteLLM Router, and durable local chat sessions run in
the same `zc` process. Sessions use tenant-namespaced atomic JSON files under
`data/chat/sessions/`; provider credentials never enter the browser.

The `zcoder` command is an alias of `zc`. Use the command entry point so
production configuration and bind/worker invariants are validated before
Uvicorn starts.

API documentation is available at `/docs` when `DEBUG=true`.

## Readiness semantics

Startup records structured health for Redis, the shared HTTP client, upload manager, and optional gRPC server.

Uploads use tenant-scoped local storage under `data/uploads/`. Completed
assemblies remain in the permission-restricted `quarantine/` directory and are
not exposed for download until a separately reviewed malware scanner can
publish a trusted clean verdict. The standalone profile does not support S3 or
another remote storage backend.

The public-local profile caps each request at 90 MiB, below Cloudflare's
documented 100 MB Free-plan request-body ceiling. Large files use verified
4 MiB chunks; the configured total file limit is a local disk policy, not a
single-request allowance. Recheck the current
[Cloudflare request limits](https://developers.cloudflare.com/workers/platform/limits/#request-and-response-limits)
before changing either limit.

Authenticated `POST`, `PUT`, `PATCH`, and `DELETE` requests require an
`Idempotency-Key` containing 8–128 safe ASCII characters. Responses are stored
under `data/idempotency/` with service-user-only permissions, bounded retention,
and request-body conflict detection. Reusing the same key after a process
restart replays the original response instead of repeating the mutation.

- Development default: failed optional integrations produce `status: degraded`
  with HTTP 200.
- Production requires `STRICT_READINESS=true`; an enabled failed integration
  produces HTTP 503.
- The standalone Docker image disables Redis and gRPC by default. The current
  HTTP runtime emits bounded structured local logs but does not initialize an
  OpenTelemetry or Prometheus exporter.

## Explicit standalone limitations

The API rejects managed worker environments, scheduled agent execution,
webhook delivery, and vault-backed agent execution with HTTP 501. Their
control-plane execution runtimes are intentionally absent from the supported
single-process profile. Vault records can be stored locally with encrypted
credentials, but those credentials are never injected into an agent run.
Iterative outcome evaluation and chat-session inputs for memory dreams are
also rejected instead of accepting fields that the standalone runtime cannot
execute.

## Development validation

```bash
python -m pip install -r requirements-dev.txt
ruff check app tests
ruff format --check app tests
mypy app
bandit -q -c pyproject.toml -r app src/wire webapp/backend
gitleaks detect --no-banner --redact
pytest -q
```

Web console tests:

```bash
python -m pip install -r webapp/requirements-web.txt httpx
pytest tests/test_webapp_server.py -v
```

## Docker

```bash
docker build -t zcoder:local .
docker compose up --build
```

The image uses the same port and health contract as local execution and removes
the nondeterministic `apt-get upgrade` build step. Deployment dependencies are
installed from `requirements-deploy.lock` with pip hash verification.

Regenerate and verify the Python 3.11/Linux deployment lock with:

```bash
make requirements-lock
make requirements-lock-check
```

## Repository map

```text
app/                    Supported FastAPI service and runtime modules
webapp/                 Web application surface
tests/                  Python test suite
src/wire/               Additional legacy/experimental wire modules
.zc/                    Agent runtime, tests, and skill definitions
docs/                   Guides, historical records, and audit reports
.github/workflows/      CI, security, and release automation
infra/cloudflare/       Canonical DNS, Tunnel, and Access infrastructure
deploy/systemd/         Hardened local zc and cloudflared services
```

## Documentation

- [Quickstart](QUICKSTART.md)
- [Architecture](ARCHITECTURE.md)
- [Product surface boundaries](docs/adr/ADR-001-product-surface-boundaries.md)
- [Agents](AGENTS.md)
- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Repository audit — 2026-07-20](docs/REPOSITORY_AUDIT_2026-07-20.md)

Living documents must match executable repository state. Historical upgrade and phase-completion documents remain immutable evidence unless a separate correction notice is added. `.zc/skills/**/SKILL.md` files are operational agent instructions and change only with the corresponding skill behavior.

## Release hardening status

The runtime and packaging defects identified by the audit are repaired.
Deployment dependencies are hash-locked, and third-party GitHub Actions are
pinned to full commit SHAs with their release tags retained as comments.
Release images carry BuildKit SBOM and max-level provenance attestations, and
the immutable image digest is recorded in the release job summary. Ruff no
longer has repository-wide ignores: legacy waivers are scoped to their product
boundaries, while the supported API keeps only its documented line-length
debt. Bandit scans the complete supported `app/` runtime without global test
skips. ADR-001 formally separates the supported API/server commands, bundled
API-driven frontend, `zc-legacy` compatibility CLI, historical web adapter,
and development-only agent tooling; tests enforce the allowed dependency
direction and package manifest.

## Security

Do not commit provider credentials or production secrets. Configure them through the deployment environment or an approved secret manager. Review [SECURITY.md](SECURITY.md) before reporting vulnerabilities.

## License

Package metadata declares MIT. Confirm repository-level license documents and third-party assets remain consistent before distribution.

## Enterprise API mode

Start the standalone API and frontend together with `zc`, `zc-api`, or
`app.main:app`. The AI response API can route through an embedded LiteLLM Router without
embedding provider credentials in clients:

```env
AI_PROVIDER=litellm
LITELLM_CONFIG_PATH=./litellm-config.yaml
LITELLM_MODEL=zc-default
```

The supported integration embeds LiteLLM's Python `Router` inside the `zc`
process. Start only `zc`; no LiteLLM proxy process, port, or master key is
required. Provider credentials remain server-side environment variables.

The public-local production profile uses two independent authorization
layers. Cloudflare Access must first supply a valid
`Cf-Access-Jwt-Assertion` signed by the configured team and scoped to the
application audience. Mutating and tenant-scoped API routes then require the
separate application bearer JWT:

```env
CLOUDFLARE_ACCESS_REQUIRED=true
CLOUDFLARE_ACCESS_TEAM_DOMAIN=https://team-name.cloudflareaccess.com
CLOUDFLARE_ACCESS_AUD=<application-audience-tag>
JWT_SECRET=<generated-application-secret>
```

Create a short-lived tenant-scoped application token on the local host:

```bash
export JWT_SECRET="<the same local production secret>"
zc token \
  --subject operator@example.com \
  --tenant default \
  --role admin \
  --expires-in 900
```

The token is printed once to standard output. Treat it as a credential and
never place it in Git, shell history, URLs, or Cloudflare configuration.

Only `/ready` and `/v1/wire/health/live` bypass origin-side Access validation
for local process health probes. The Cloudflare Tunnel ingress still requires
Access before those paths can be reached through `https://zeaz.dev`.

Authenticated callers can discover sanitized model aliases at
`GET /v1/ai/models`. AI responses preserve LiteLLM prompt/completion token
usage, and `/ready` reports embedded-router initialization as the `ai_provider`
component. See the
[LiteLLM integration contract](docs/reports/litellm-integration.md).

The runtime dependency is hash-locked to the audited LiteLLM release. Start
the canonical server with:

```bash
zc-api --host 127.0.0.1 --port 8000 --workers 1
export ZC_API_URL=http://127.0.0.1:8000
export ZC_API_TOKEN="<short-lived-application-token>"
```

The historical command surface remains explicitly available as `zc-legacy`
during the compatibility period. Provider credentials remain on the API host.
Resource access is scoped by the authenticated JWT tenant, and vault secret
values are write-only through the API.
