# Quickstart

This guide covers the verified FastAPI runtime on the current branch. The repository also contains CLI-oriented and agent modules, but the installed `zc`/`zcoder` console-script entry points require correction before they should be treated as a supported installation path.

## Prerequisites

- Python 3.11 or 3.12
- `pip`
- Redis only when Redis-backed features are enabled
- Docker only for the container workflow

## Run from source

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-enterprise.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Windows PowerShell activation:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements-enterprise.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Verify the service

```bash
curl -fsS http://127.0.0.1:8000/ready
curl -fsS http://127.0.0.1:8000/v1/wire/health/live
```

Expected readiness response:

```json
{"status":"ready"}
```

The OpenAPI UI is exposed at `http://127.0.0.1:8000/docs` only when debug configuration enables documentation endpoints.

## Development checks

```bash
python -m pip install -r requirements-dev.txt
ruff check .
mypy . --ignore-missing-imports
pytest --ignore=tests/test_webapp_server.py --cov --cov-report=term-missing
```

Run the web application tests with their additional dependencies:

```bash
python -m pip install -r webapp/requirements-web.txt httpx
pytest tests/test_webapp_server.py -v
```

## Docker

```bash
docker build -t zcoder:local .
docker run --rm --name zcoder-local -p 8000:8000 zcoder:local
```

In another terminal:

```bash
curl -fsS http://127.0.0.1:8000/v1/wire/health/live
```

## Configuration

Configuration is resolved by `app.core.config`. Keep secrets out of source control and inject them through environment variables or the deployment secret manager.

Before enabling Redis, gRPC, external providers, or production CORS, review the applicable configuration module and deployment profile. Startup currently tolerates initialization failure for several components, so `/ready` should not yet be interpreted as proof that every optional integration is healthy.

## Known limitation

`setup.cfg` currently maps the installed commands `zc` and `zcoder` to `app.main:cli`, while the audited module does not define that function. Use the Uvicorn command above for the verified API workflow until the console entry point is repaired and covered by an installation smoke test.

For findings, risk priorities, and the remediation plan, see [Repository Audit — 2026-07-20](docs/REPOSITORY_AUDIT_2026-07-20.md).