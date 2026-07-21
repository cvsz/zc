.PHONY: setup install install-dev test test-cov lint format typecheck security audit check run tui \
        docker-build docker-run health clean build start stop restart update upgrade updgrade status \
        logs bootstrap requirements-lock requirements-lock-check package-wheel config-gen test-config-gen

# Canonical local-first FastAPI + bundled React runtime.
VENV        := .venv
VENV_PY     := $(VENV)/bin/python
VENV_PIP    := $(VENV)/bin/pip
VENV_UVICORN:= $(VENV)/bin/uvicorn
PID_FILE    := .zc.pid
LOG_FILE    := logs/zc.log
HOST        ?= 127.0.0.1
PORT        ?= 8000

# Idempotent developer and CI setup entrypoint.
setup: bootstrap

build:
	@test -d $(VENV) || python3 -m venv $(VENV)
	$(VENV_PIP) install --upgrade pip --disable-pip-version-check -q
	$(VENV_PIP) install --require-hashes -q -r requirements-deploy.lock
	npm --prefix webapp/frontend-src ci
	npm --prefix webapp/frontend-src run build
	@mkdir -p logs
	@echo "✅ build complete — venv at $(VENV)/"

start:
	@if [ -f $(PID_FILE) ] && kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
		echo "⚠️  already running (pid $$(cat $(PID_FILE))) — use 'make restart'"; \
		exit 1; \
	fi
	@test -x $(VENV_UVICORN) || { echo "❌ not built yet — run 'make build' first"; exit 1; }
	@mkdir -p logs
	@setsid nohup env PYTHONPATH=src ENVIRONMENT=development AUTH_REQUIRED=false \
		API_HOST=$(HOST) API_PORT=$(PORT) PROTOBUF_ENABLED=false \
		$(VENV_UVICORN) app.main:app --app-dir . --host $(HOST) --port $(PORT) --workers 1 \
		< /dev/null > $(LOG_FILE) 2>&1 & echo $$! > $(PID_FILE)
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

update: build
	@echo "✅ local dependencies and frontend rebuilt from repository locks"

upgrade: update
	@echo "🔎 version: $$(PYTHONPATH=src $(VENV_PY) -c 'from app.core.config import APP_VERSION; print(APP_VERSION)')"
	@$(MAKE) check
	@if [ -f $(PID_FILE) ] && kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
		echo "🔁 restarting running server to pick up the upgrade…"; \
		$(MAKE) restart; \
	else \
		echo "ℹ️  server wasn't running — 'make start' whenever you're ready"; \
	fi
	@echo "✅ upgrade verification complete"

# Backward-compatible spelling retained for existing operator runbooks.
updgrade: upgrade

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

install: build

install-dev:
	@test -d $(VENV) || python3 -m venv $(VENV)
	$(VENV_PIP) install -r requirements-dev.txt

requirements-lock:
	uv pip compile --python-version 3.11 --python-platform x86_64-unknown-linux-gnu \
		--generate-hashes --custom-compile-command "make requirements-lock" \
		--output-file requirements-deploy.lock requirements-deploy.in

requirements-lock-check:
	uv pip compile --quiet --python-version 3.11 --python-platform x86_64-unknown-linux-gnu \
		--generate-hashes --custom-compile-command "make requirements-lock" \
		--output-file /tmp/requirements-deploy.lock requirements-deploy.in
	cmp requirements-deploy.lock /tmp/requirements-deploy.lock

test:
	PYTHONPATH=src pytest

test-cov:
	PYTHONPATH=src pytest --cov=app tests/ --cov-report=term-missing --cov-fail-under=70

lint:
	ruff check .

format:
	black .

typecheck:
	mypy app

security:
	bandit -q -c pyproject.toml -r app

audit:
	ruff check .
	bandit -c pyproject.toml -r app
	PYTHONPATH=src pytest --cov=app tests/ --cov-report=term-missing --cov-fail-under=70

proto-gen:
	python -m grpc_tools.protoc -I app/proto \
		--python_out=app/proto \
		--grpc_python_out=app/proto \
		app/proto/wire.proto
	perl -pi -e 's/^import wire_pb2 as/from . import wire_pb2 as/' app/proto/wire_pb2_grpc.py

check: lint typecheck security test-cov

package-wheel:
	rm -rf build dist
	npm --prefix webapp/frontend-src ci
	npm --prefix webapp/frontend-src run build
	python -m pip wheel . --no-deps --wheel-dir dist
	@unzip -l dist/zcoder-*.whl | grep -q 'app/main.py'
	@unzip -l dist/zcoder-*.whl | grep -q 'webapp/frontend-dist/index.html'
	@! unzip -l dist/zcoder-*.whl | grep -Eq \
		'app/api/control_panel.py|app/core/(security|monitoring|performance|resiliency).py|app/services/storage.py'

run:
	PYTHONPATH=src ENVIRONMENT=development AUTH_REQUIRED=false PROTOBUF_ENABLED=false \
		python -m app.main --host 127.0.0.1 --port 8000 --workers 1

tui:
	@echo "Starting the optional legacy CLI TUI"
	PYTHONPATH=src python -m wire.main --tui

health:
	curl -fsS http://127.0.0.1:8000/ready

bootstrap:
	@echo "🔍 Running pre-flight checks before install..."
	@command -v python3 >/dev/null 2>&1 || { echo >&2 "❌ Python 3 is required but it's not installed. Aborting."; exit 1; }
	@command -v npm >/dev/null 2>&1 || { echo >&2 "❌ npm is required but it's not installed. Aborting."; exit 1; }
	@echo "✅ System requirements met. Proceeding to install..."
	$(MAKE) build
	$(MAKE) install-dev
	@echo "🎉 Bootstrap complete! System is ready."

docker-build:
	docker build -t zcoder:local .

docker-run:
	docker run --rm --network host \
		-e ENVIRONMENT=development \
		-e AUTH_REQUIRED=false \
		-e PROTOBUF_ENABLED=false \
		-e ANTHROPIC_API_KEY=$${ANTHROPIC_API_KEY:-} \
		zcoder:local

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	rm -rf .pytest_cache .mypy_cache .ruff_cache .coverage coverage.xml dist build
	rm -f .zc.pid

config-gen:
	python scripts/zai-config-gen.py generate

test-config-gen:
	python -m py_compile scripts/zai-config-gen.py
	python -m pytest tests/test_config_gen.py
