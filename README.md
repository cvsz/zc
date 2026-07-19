# zcoder / wire

Python 3.11+ repository containing a FastAPI API service, supporting web components, CLI-oriented modules, tests, container packaging, and enterprise integration experiments.

> The repository currently contains overlapping product identities (`zcoder`, `wire`, and `wire-enterprise`). Treat `app.main:app` as the verified API entry point on this branch. See the repository audit for known packaging and documentation inconsistencies.

## Current verified capabilities

- FastAPI application with Uvicorn runtime
- REST routes under `/v1/wire`
- Readiness endpoint at `/ready`
- Liveness endpoint at `/v1/wire/health/live`
- Optional Redis-backed cache
- Upload manager and HTTP client lifecycle management
- Optional gRPC startup when enabled by configuration
- Python 3.11 and 3.12 test coverage in CI
- Ruff, Black, mypy, Bandit, CodeQL, and Docker smoke checks

Claims in historical phase-completion documents and benchmark tables are not automatically equivalent to current production validation. Consult the dated audit report and reproduce benchmarks before using performance figures in capacity planning.

## Quick start

### Create an environment

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-enterprise.txt
```

### Run the API

```bash
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Verify readiness:

```bash
curl -fsS http://127.0.0.1:8000/ready
```

API documentation is available at `/docs` only when debug mode enables the documentation endpoints.

## Development validation

```bash
python -m pip install -r requirements-dev.txt
ruff check .
mypy . --ignore-missing-imports
pytest --ignore=tests/test_webapp_server.py --cov --cov-report=term-missing
pytest tests/test_webapp_server.py -v
```

The CI workflow also builds the Docker image and performs a readiness smoke test.

## Docker

```bash
docker build -t zcoder:local .
docker run --rm -p 8000:8000 zcoder:local
curl -fsS http://127.0.0.1:8000/v1/wire/health/live
```

The Dockerfile currently serves `app.main:app` on port `8000` as a non-root user.

## Repository map

```text
app/                    FastAPI service and enterprise runtime modules
webapp/                 Web application surface
tests/                  Python test suite
src/wire/               Additional wire modules; packaging relationship requires consolidation
.zc/                    Agent runtime, tests, and skill definitions
docs/                   Guides, historical upgrade records, and audit reports
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

Historical `docs/*upgrade*`, `docs/enterprise/*COMPLETE*`, and skill `SKILL.md` files serve different purposes:

- Upgrade and completion documents are point-in-time records.
- Living documents such as this README and the Quickstart must match executable repository state.
- `.zc/skills/**/SKILL.md` files are operational agent instructions and should change only with the relevant skill implementation.

## Known high-priority issues

1. `setup.cfg` declares `zc` and `zcoder` console scripts targeting `app.main:cli`, but the audited `app/main.py` does not define `cli`.
2. Package metadata, README, and roadmap use conflicting names and versions.
3. Docker, CI, and historical documentation contain inconsistent port assumptions.
4. Ruff and Bandit use broad global exclusions that should be narrowed and justified.
5. Dependency locking, SBOM generation, and release provenance are not yet enforced as a single reproducible release contract.

See the [full repository audit](docs/REPOSITORY_AUDIT_2026-07-20.md) for severity, evidence, limitations, and remediation sequencing.

## Security

Do not commit provider credentials or production secrets. Configure them through the deployment environment or an approved secret manager. Review [SECURITY.md](SECURITY.md) before reporting or remediating vulnerabilities.

## License

Package metadata declares the project license as MIT. Confirm that all repository-level license documents and third-party assets remain consistent with that declaration before distribution.