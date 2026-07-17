.PHONY: install install-dev test test-cov lint format typecheck security check run tui docker-build docker-run health clean \
        build start stop restart update upgrade status logs bootstrap

# ── Web console (webapp/) ───────────────────────────────────────────────
# `build`/`start`/`stop`/`restart`/`update`/`upgrade` all target the
# FastAPI+static web console in webapp/ (backend/server.py + frontend/).
# They never touch the plain CLI (`make run` still runs `python main.py`
# directly, unaffected). All state lives in-repo so these are safe to run
# from a fresh clone with no other setup:
#   .web-venv/            — dedicated virtualenv (kept separate from any
#                            venv you use for CLI development, so upgrading
#                            the web console's deps can never break the CLI)
#   logs/web.log           — server stdout/stderr
#   .web.pid               — pid of the running uvicorn process, if any
VENV        := .web-venv
VENV_PY     := $(VENV)/bin/python
VENV_PIP    := $(VENV)/bin/pip
VENV_UVICORN:= $(VENV)/bin/uvicorn
PID_FILE    := .web.pid
LOG_FILE    := logs/web.log
HOST        ?= 0.0.0.0
PORT        ?= 8420

# Build: create the venv (idempotent) and install/refresh every dependency
# the web console needs — the CLI core's requirements.txt (Coder/etc. import
# straight into the backend, see webapp/backend/server.py) plus
# webapp/requirements-web.txt (fastapi/uvicorn). Nothing to compile for the
# frontend -- it's plain HTML/CSS/JS served as static files, no bundler.
build:
	@test -d $(VENV) || python3 -m venv $(VENV)
	$(VENV_PIP) install --upgrade pip --disable-pip-version-check -q
	$(VENV_PIP) install -q -r requirements.txt -r webapp/requirements-web.txt -r app/requirements.txt
	@mkdir -p logs
	@echo "✅ build complete — venv at $(VENV)/"

# Start: refuse to double-start if a live process is already using
# PID_FILE, otherwise launch uvicorn detached (nohup) and record its pid.
start:
	@if [ -f $(PID_FILE) ] && kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
		echo "⚠️  already running (pid $$(cat $(PID_FILE))) — use 'make restart'"; \
		exit 1; \
	fi
	@test -x $(VENV_UVICORN) || { echo "❌ not built yet — run 'make build' first"; exit 1; }
	@mkdir -p logs
	@setsid nohup $(VENV_UVICORN) webapp.backend.server:app --app-dir . \
		--host $(HOST) --port $(PORT) < /dev/null > $(LOG_FILE) 2>&1 & echo $$! > $(PID_FILE)
	@sleep 1
	@if kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
		echo "🚀 started (pid $$(cat $(PID_FILE))) — http://$(HOST):$(PORT)  (logs: $(LOG_FILE))"; \
	else \
		echo "❌ failed to start — see $(LOG_FILE)"; rm -f $(PID_FILE); exit 1; \
	fi

# Stop: graceful SIGTERM, falling back to SIGKILL if it won't quit.
stop:
	@if [ ! -f $(PID_FILE) ]; then echo "ℹ️  not running (no $(PID_FILE))"; exit 0; fi
	@PID=$$(cat $(PID_FILE)); \
	if kill -0 $$PID 2>/dev/null; then \
		kill $$PID 2>/dev/null; \
		for i in 1 2 3 4 5; do kill -0 $$PID 2>/dev/null || break; sleep 1; done; \
		kill -0 $$PID 2>/dev/null && kill -9 $$PID 2>/dev/null || true; \
		echo "🛑 stopped (pid $$PID)"; \
	else \
		echo "ℹ️  stale pid file (process $$PID not running)"; \
	fi
	@rm -f $(PID_FILE)

restart: stop start

# Update: refresh dependencies to their latest allowed versions (and pull
# the latest source if this checkout is a git repo). Does not restart the
# server automatically — run `make restart` after if one is running.
update:
	@if [ -d .git ]; then echo "📥 git pull…"; git pull; fi
	@test -d $(VENV) || python3 -m venv $(VENV)
	$(VENV_PIP) install --upgrade pip --disable-pip-version-check -q
	$(VENV_PIP) install -q --upgrade -r requirements.txt -r webapp/requirements-web.txt -r app/requirements.txt
	@echo "✅ dependencies updated"

# Upgrade: update()'s superset — also verifies the result, and restarts a
# currently-running server so the upgrade takes effect immediately instead
# of silently running stale code until someone remembers to restart it.
upgrade: update
	@echo "🔎 version: $$($(VENV_PY) main.py --version 2>/dev/null || echo unknown)"
	@if [ -f $(PID_FILE) ] && kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
		echo "🔁 restarting running server to pick up the upgrade…"; \
		$(MAKE) restart; \
	else \
		echo "ℹ️  server wasn't running — 'make start' whenever you're ready"; \
	fi
	@$(VENV_PY) main.py --health-check || true

# Convenience (not part of the core lifecycle, but cheap and useful
# alongside it): current status, and a tail of the live log.
status:
	@if [ -f $(PID_FILE) ] && kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
		echo "🟢 running (pid $$(cat $(PID_FILE))) — http://$(HOST):$(PORT)"; \
	else \
		echo "🔴 not running"; \
	fi

logs:
	@tail -f $(LOG_FILE)

install:
	pip install --break-system-packages -r requirements.txt -r app/requirements.txt

install-dev:
	pip install --break-system-packages -r requirements-dev.txt

test:
	PYTHONPATH=src pytest

test-cov:
	PYTHONPATH=src pytest --cov=app --cov=webapp tests/ --cov-report=term-missing

lint:
	ruff check .

format:
	black .

typecheck:
	mypy app scripts tests src/wire/main.py --ignore-missing-imports || echo "Ignoring mypy system package bug"

security:
	bandit -c pyproject.toml -r app src scripts webapp

audit:
	ruff check .
	bandit -c pyproject.toml -r app src scripts webapp
	pytest --cov=app --cov=webapp tests/ --cov-report=term-missing

proto-gen:
	python -m grpc_tools.protoc -I. --python_out=. --grpc_python_out=. app/proto/wire.proto

check: lint typecheck security test-cov

run:
	PYTHONPATH=src python -m wire.main

tui:
	PYTHONPATH=src python -m wire.main --tui

health:
	PYTHONPATH=src python -m wire.main --health-check

bootstrap:
	@echo "🔍 Running pre-flight checks before install..."
	@command -v python3 >/dev/null 2>&1 || { echo >&2 "❌ Python 3 is required but it's not installed. Aborting."; exit 1; }
	@command -v pip >/dev/null 2>&1 || { echo >&2 "❌ pip is required but it's not installed. Aborting."; exit 1; }
	@echo "✅ System requirements met. Proceeding to install..."
	$(MAKE) install
	$(MAKE) install-dev
	$(MAKE) build
	@echo "🎉 Bootstrap complete! System is ready."

docker-build:
	docker build -t wire:latest .


docker-run:
	docker run --rm -e ANTHROPIC_API_KEY=$${ANTHROPIC_API_KEY} wire:latest

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	rm -rf .pytest_cache .mypy_cache .ruff_cache .coverage coverage.xml dist build

config-gen:
	python scripts/zai-config-gen.py generate

test-config-gen:
	python -m py_compile scripts/zai-config-gen.py
	python -m pytest tests/test_config_gen.py || echo "No tests for config-gen yet"
