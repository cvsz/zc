"""Regression tests for the supported zcoder API runtime contract."""

import sys

from fastapi.testclient import TestClient

from app import main
from app.core.config import APP_NAME, APP_VERSION, DEFAULT_API_PORT, Config


def test_config_defaults_are_canonical() -> None:
    config = Config()
    assert config.app_name == APP_NAME == "zcoder"
    assert config.version == APP_VERSION == "1.33.0"
    assert config.api_port == DEFAULT_API_PORT == 8000


def test_root_exposes_canonical_identity() -> None:
    client = TestClient(main.app)
    response = client.get("/")
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "zcoder"
    assert body["version"] == "1.33.0"
    assert body["readiness"] == "/ready"


def test_readiness_reports_component_state() -> None:
    main.app.state.components = {
        "redis": {"ready": True, "error": "disabled"},
        "http_client": {"ready": True, "error": None},
    }
    response = TestClient(main.app).get("/ready")
    assert response.status_code == 200
    assert response.json()["status"] == "ready"


def test_cli_forwards_parsed_runtime_options(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_run_server(*, host: str, port: int, workers: int) -> None:
        captured.update(host=host, port=port, workers=workers)

    monkeypatch.setattr(main, "run_server", fake_run_server)
    monkeypatch.setattr(
        sys,
        "argv",
        ["zc", "--host", "127.0.0.1", "--port", "9000", "--workers", "2"],
    )

    main.cli()

    assert captured == {"host": "127.0.0.1", "port": 9000, "workers": 2}
