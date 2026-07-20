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
- CI: Ruff, Black, mypy, full `app/` Bandit scan, package-install smoke tests, pytest, CodeQL, and Docker smoke tests

Historical phase-completion reports and benchmark tables are point-in-time records. Reproduce benchmarks before using numerical performance claims for sizing or service-level objectives.

## Quick start

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install .
zc --host 127.0.0.1 --port 8000 --workers 1
```

Verify the service:

```bash
curl -fsS http://127.0.0.1:8000/ready
curl -fsS http://127.0.0.1:8000/v1/wire/health/live
```

The `zcoder` command is an alias of `zc`. Direct execution remains available:

```bash
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

API documentation is available at `/docs` when `DEBUG=true`.

## Readiness semantics

Startup records structured health for Redis, the shared HTTP client, upload manager, and optional gRPC server.

- Default: failed optional integrations produce `status: degraded` with HTTP 200.
- `STRICT_READINESS=true`: an enabled failed integration produces HTTP 503.
- The standalone Docker image disables Redis, gRPC, NATS, and OpenTelemetry by default. Enable them explicitly when the corresponding infrastructure is present.

## Development validation

```bash
python -m pip install -r requirements-dev.txt
ruff check .
black --check app tests
mypy . --ignore-missing-imports
bandit -r app -ll
pytest --ignore=tests/test_webapp_server.py --cov --cov-report=term-missing
```

Web console tests:

```bash
python -m pip install -r webapp/requirements-web.txt httpx
pytest tests/test_webapp_server.py -v
```

## Docker

```bash
docker build -t zcoder:local .
docker run --rm --name zcoder-local -p 8000:8000 zcoder:local
```

The image uses the same port and health contract as local execution and removes the nondeterministic `apt-get upgrade` build step.

## Repository map

```text
app/                    Supported FastAPI service and runtime modules
webapp/                 Web application surface
tests/                  Python test suite
src/wire/               Additional legacy/experimental wire modules
.zc/                    Agent runtime, tests, and skill definitions
docs/                   Guides, historical records, and audit reports
.github/workflows/      CI, security, release, and delivery automation
k8s/, argocd/           Deployment and GitOps assets
monitoring/             Observability assets
```

## Documentation

- [Quickstart](QUICKSTART.md)
- [Architecture](ARCHITECTURE.md)
- [Agents](AGENTS.md)
- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Repository audit — 2026-07-20](docs/REPOSITORY_AUDIT_2026-07-20.md)

Living documents must match executable repository state. Historical upgrade and phase-completion documents remain immutable evidence unless a separate correction notice is added. `.zc/skills/**/SKILL.md` files are operational agent instructions and change only with the corresponding skill behavior.

## Remaining release-hardening work

The runtime and packaging defects identified by the audit are repaired. Remaining non-blocking release engineering work includes:

1. Generate hash-locked deployment dependencies.
2. Pin critical GitHub Actions to reviewed commit SHAs.
3. Generate SBOM and provenance attestations for release images.
4. Gradually replace broad legacy Ruff/Bandit suppressions with scoped justifications outside the supported `app/` runtime.
5. Consolidate or formally separate `app/`, `src/wire/`, web, and agent product surfaces.

## Security

Do not commit provider credentials or production secrets. Configure them through the deployment environment or an approved secret manager. Review [SECURITY.md](SECURITY.md) before reporting vulnerabilities.

## License

Package metadata declares MIT. Confirm repository-level license documents and third-party assets remain consistent before distribution.
