# Repository Audit Report — 2026-07-20

## Executive summary

This audit reviewed the repository structure, packaging metadata, runtime entry points, container image, GitHub Actions workflows, tests, security checks, and the primary user-facing documentation on branch `codex/fix-dev-httpx-dependency`.

The immediate CI blocker was an invalid development dependency named `httpx2`. It has been replaced with `httpx>=0.27.0`, restoring installation for lint, type-check, security, unit-test, and web-test jobs.

The repository is operational, but its documentation and packaging surfaces describe overlapping products and contain material inconsistencies. The highest-priority follow-up is to establish a single canonical product identity and runtime contract.

## Audit scope

- Python package metadata and dependency declarations
- FastAPI application entry point
- Docker image and health contract
- GitHub Actions CI and CI/CD workflows
- Python 3.11 and 3.12 test matrix
- Ruff, Black, mypy, Bandit, and CodeQL coverage
- Root documentation and release/roadmap consistency
- Security, reliability, maintainability, and deployment risks

## Verified repository state

### Runtime

- Primary API application: `app.main:app`
- Runtime framework: FastAPI with Uvicorn
- Supported Python version: Python 3.11 or newer
- Readiness endpoint: `GET /ready`
- Liveness endpoint: `GET /v1/wire/health/live`
- Metrics reference from the root endpoint: `/v1/wire/metrics/performance`
- Optional gRPC service is started during application lifespan when enabled

### Packaging

`setup.cfg` identifies the distribution as `zcoder` version `1.33.0`, but its console entry points target `app.main:cli`. The inspected `app/main.py` exposes `app`, `run_server`, and the module entry point, but does not expose a `cli` symbol. This is a packaging defect for installed console commands and requires a dedicated code change plus tests.

The package discovery rule includes only `app*`, `config*`, and `webapp*`. Other source trees, including `src/wire`, are not included by this configuration. The project must decide whether these are separate products, legacy code, or missing package targets.

### Continuous integration

The following checks passed after correcting the invalid dependency:

- Ruff lint
- Black check for changed Python files
- mypy type checking
- Bandit scan for changed Python files
- pytest on Python 3.11
- pytest on Python 3.12
- FastAPI/web application tests
- coverage artifact generation
- CodeQL
- Docker image build and container startup

The CI workflow intentionally limits Black and Bandit to changed Python files. This avoids blocking unrelated changes on legacy findings, but it is not equivalent to a repository-wide formatting or security guarantee.

## Findings

### P0 — Release and execution integrity

#### 1. Broken console-script entry points

`setup.cfg` declares:

```ini
zc = app.main:cli
zcoder = app.main:cli
```

The inspected application module does not define `cli`. Installed `zc` and `zcoder` commands are therefore expected to fail at import/attribute resolution.

**Required remediation**

- Implement a stable `cli()` entry point, or point the scripts at the actual CLI module.
- Add an installation smoke test that builds the package and runs `zc --help` and `zcoder --help`.

#### 2. Product identity conflict

The repository uses several identities interchangeably:

- `wire`
- `wire-enterprise`
- `zcoder`
- `ZaiCoder CLI`
- `AI Model Coder CLI`

This affects README content, package metadata, executable names, Docker image naming, API descriptions, and roadmap claims.

**Required remediation**

Choose one canonical product name and define aliases explicitly. Update package metadata, CLI help, container labels, API title, documentation, and release automation together.

### P1 — Documentation correctness

#### 3. Quickstart referenced a nonexistent root `main.py`

The previous quickstart instructed users to run `python main.py`, but no root-level `main.py` exists on the audited branch. The API entry point is `app.main:app`.

#### 4. README overstated verification

The README presented numerical performance improvements and all enterprise phases as complete without linking reproducible benchmark inputs, commands, environments, or CI artifacts. Such values must be treated as targets or historical claims until benchmark evidence is versioned and repeatable.

#### 5. Conflicting versions

Observed versions include:

- README: `2026.1.0`
- Package metadata: `1.33.0`
- Roadmap heading: `1.32.0`

A release process should update these from one source of truth.

#### 6. Port contract inconsistency

- Dockerfile exposes and serves HTTP on port `8000`.
- Existing README examples used port `8420`.
- CI smoke testing maps port `8420:8420` and checks `/ready`.

The branch happened to pass its current smoke path, but the declared Dockerfile contract and documentation must be normalized to the runtime configuration actually used by the image.

### P1 — Security

#### 7. Broad Bandit suppressions

The Bandit configuration suppresses numerous checks, including subprocess, weak hash, hard-coded password, temporary-file, and unsafe deserialization-related categories. Some exceptions may be justified, but global suppression materially reduces detection coverage.

**Required remediation**

- Replace global skips with narrow, line-level suppressions.
- Record the justification and threat model for every retained exception.
- Add a scheduled repository-wide Bandit job in addition to changed-file gating.

#### 8. CORS policy needs explicit production configuration

The application allows wildcard origins in debug and uses `http://localhost:*` otherwise while credentials are enabled. Browser CORS matching does not treat arbitrary wildcard port syntax as a general origin matcher in the same way shell patterns do.

**Required remediation**

Use an explicit, validated allow-list from configuration and test accepted/rejected origins.

#### 9. Mutable and unpinned build inputs

Dependencies use lower bounds without lock hashes, and GitHub Actions are referenced by major tags. This is convenient but weakens reproducibility and supply-chain assurance.

**Required remediation**

- Introduce a generated lock file with hashes for deployable builds.
- Pin critical Actions by commit SHA and maintain them with Dependabot/Renovate.
- Generate an SBOM and provenance attestation for release images.

### P1 — Reliability and operations

#### 10. Startup failures are degraded silently

Cache, HTTP client, upload manager, and gRPC initialization exceptions are printed and startup continues. This may be appropriate for optional components, but mandatory/optional status is not explicit.

**Required remediation**

Classify dependencies as required or optional. Fail readiness for required dependency failures and expose structured component health.

#### 11. Logging is print-based

Lifecycle diagnostics use `print()` rather than structured logging. This limits correlation, filtering, redaction, and production observability.

#### 12. Docker build performs unrestricted OS upgrade

`apt-get upgrade -y` makes image contents vary with repository state and increases build time and change surface.

**Required remediation**

Use a patched base image digest, install only required packages, and rebuild regularly through automated dependency updates.

### P2 — Maintainability and test architecture

#### 13. Configuration is split across multiple standards

Ruff and Bandit are configured in `pyproject.toml`, while pytest, mypy, coverage, package metadata, and entry points are in `setup.cfg`. This is valid but increases drift risk.

#### 14. Lint policy ignores many correctness/style categories

The Ruff configuration globally ignores a broad set of rules, including unused imports and variables. This can conceal dead code and import errors.

#### 15. Repository-wide documentation lacks freshness metadata

Historical upgrade documents should remain immutable records, while living documents should declare owner, last validation date, applicable version, and evidence links.

## Documentation policy adopted by this audit

- `README.md`: current, verified overview only
- `QUICKSTART.md`: commands that map to files and entry points present on the branch
- `ROADMAP.md`: forward-looking plan and explicitly dated audit claims
- `CHANGELOG.md`: chronological release record
- `docs/REPOSITORY_AUDIT_*.md`: point-in-time evidence and remediation backlog
- Historical upgrade and phase-completion documents: retained as historical records; do not rewrite their original claims without an explicit correction note
- `.zc/skills/**/SKILL.md`: operational agent instructions, not general product documentation; update only when the corresponding skill behavior changes

## Remediation plan

### Immediate

1. Merge the `httpx` dependency correction after all required checks complete.
2. Fix console entry points and add package-install smoke tests.
3. Normalize the Docker HTTP port and health endpoints across Dockerfile, CI, configuration, and documentation.
4. Establish the canonical project name and version source.

### Next release

1. Add lock files, SBOM generation, and provenance.
2. Reduce Bandit and Ruff suppressions.
3. Add repository-wide scheduled security and formatting checks.
4. Add structured logging and dependency-aware readiness.
5. Add documentation link validation and executable command checks.

### Medium term

1. Separate or consolidate the CLI, API, web application, and `src/wire` trees.
2. Define supported deployment profiles and their required dependencies.
3. Publish reproducible benchmark methodology before presenting performance multipliers as verified facts.
4. Add architecture decision records for identity, packaging, ports, security boundaries, and optional services.

## Definition of done

The repository can be considered internally consistent when:

- Package installation produces working `zc` and `zcoder` commands.
- One version source drives package metadata and documentation.
- README and Quickstart commands run successfully in CI.
- Docker, local development, and CI use the same documented port contract.
- Required dependencies determine readiness correctly.
- Security suppressions are narrow and justified.
- Release artifacts include lock-based dependencies, SBOM, provenance, and signed or attestable images.
- Living Markdown documents pass link, command, and freshness validation.

## Audit limitations

This report is a static repository and CI configuration audit. It does not claim production penetration testing, load testing, chaos testing, Kubernetes deployment validation, or verification of external provider behavior. Performance figures require a separate reproducible benchmark run.