# Quickstart

Validated for `zcoder` 1.33.0 on Python 3.11 and 3.12.

## Install from source

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install .
cp .env.example .env
```

Set `ANTHROPIC_API_KEY` in the ignored `.env` file before making model calls.
The development server can start without it, but embedded LiteLLM readiness
will be degraded and inference will be unavailable.

Windows PowerShell:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install .
Copy-Item .env.example .env
```

## Run through the installed command

Both commands are supported aliases:

```bash
zc --host 127.0.0.1 --port 8000 --workers 1
# or
zcoder --host 127.0.0.1 --port 8000 --workers 1
```

Direct Uvicorn execution is for local development diagnostics only. Use the
installed `zc` command in production so bind and worker invariants are checked
before Uvicorn starts:

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
ruff check app tests
ruff format --check app tests
mypy app
bandit -q -c pyproject.toml -r app src/wire webapp/backend
pytest -q
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
docker compose up
```

The Compose profile uses host networking because the canonical process binds
to `127.0.0.1`; bridge-mode `-p 8000:8000` cannot reach a loopback-only
listener inside the container. Redis and gRPC are optional and disabled by
default. NATS and OpenTelemetry runtimes are not wired into the supported
standalone process.

## Important configuration

| Variable | Default | Purpose |
|---|---:|---|
| `APP_NAME` | `zcoder` | API and runtime identity |
| `APP_VERSION` | `1.33.0` | Runtime version |
| `API_PORT` | `8000` | HTTP listen port |
| `STRICT_READINESS` | `false` | Return 503 when an enabled component fails |
| `REDIS_ENABLED` | `false` | Redis cache integration |
| `PROTOBUF_ENABLED` | `true` from source; `false` in Docker | gRPC integration |
| `DEBUG` | `false` | Development CORS and API documentation |

Keep secrets out of source control. Inject them through environment variables or a deployment secret manager.

For findings, completed remediation, and remaining release-hardening work, see [Repository Audit — 2026-07-20](docs/REPOSITORY_AUDIT_2026-07-20.md).
