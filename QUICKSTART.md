# Quickstart

Validated for `zcoder` 1.33.0 on Python 3.11 and 3.12.

## Install from source

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install .
```

Windows PowerShell:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install .
```

## Run through the installed command

Both commands are supported aliases:

```bash
zc --host 127.0.0.1 --port 8000 --workers 1
# or
zcoder --host 127.0.0.1 --port 8000 --workers 1
```

Direct Uvicorn execution remains available:

```bash
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

## Verify the service

```bash
curl -fsS http://127.0.0.1:8000/ready
curl -fsS http://127.0.0.1:8000/v1/wire/health/live
```

Readiness returns structured component state. With `STRICT_READINESS=true`, a required enabled component failure returns HTTP 503; otherwise the service reports `degraded` with HTTP 200 so optional integrations can fail independently.

OpenAPI UI is exposed at `http://127.0.0.1:8000/docs` only when `DEBUG=true`.

## Development checks

```bash
python -m pip install -r requirements-dev.txt
ruff check .
black --check app tests
mypy . --ignore-missing-imports
bandit -r app -ll
pytest --ignore=tests/test_webapp_server.py --cov --cov-report=term-missing
```

Web console tests require the additional web dependencies:

```bash
python -m pip install -r webapp/requirements-web.txt httpx
pytest tests/test_webapp_server.py -v
```

## Docker

The container uses the same HTTP contract as local execution: port `8000`, `/ready`, and `/v1/wire/health/live`.

```bash
docker build -t zcoder:local .
docker run --rm --name zcoder-local -p 8000:8000 zcoder:local
```

The default standalone image disables Redis, gRPC, NATS, and OpenTelemetry. Enable integrations explicitly through environment variables and provide their infrastructure before turning on strict readiness.

## Important configuration

| Variable | Default | Purpose |
|---|---:|---|
| `APP_NAME` | `zcoder` | API and runtime identity |
| `APP_VERSION` | `1.33.0` | Runtime version |
| `API_PORT` | `8000` | HTTP listen port |
| `STRICT_READINESS` | `false` | Return 503 when an enabled component fails |
| `REDIS_ENABLED` | `true` from source; `false` in Docker | Redis cache integration |
| `PROTOBUF_ENABLED` | `true` from source; `false` in Docker | gRPC integration |
| `DEBUG` | `false` | Development CORS and API documentation |

Keep secrets out of source control. Inject them through environment variables or a deployment secret manager.

For findings, completed remediation, and remaining release-hardening work, see [Repository Audit — 2026-07-20](docs/REPOSITORY_AUDIT_2026-07-20.md).
