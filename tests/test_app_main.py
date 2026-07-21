"""Regression tests for the supported zcoder API runtime contract."""

import base64
import sys
from pathlib import Path

import httpx
import pytest

from app import main
import app.core.config as config_module
from app.core.config import APP_NAME, APP_VERSION, DEFAULT_API_PORT, Config


def test_config_defaults_are_canonical() -> None:
    config = Config()
    assert config.app_name == APP_NAME == "zcoder"
    assert config.version == APP_VERSION == "1.33.0"
    assert config.api_port == DEFAULT_API_PORT == 8000
    assert config.api_host == "127.0.0.1"
    assert config.api_workers == 1
    assert config.storage_backend == "local"
    assert config.upload_temp_dir.as_posix() == "data/uploads"
    assert config.redis_enabled is False
    assert config.rate_limit_enabled is False


def test_config_rejects_multi_worker_in_memory_rate_limiting() -> None:
    config = Config(
        environment="production",
        auth_required=False,
        rate_limit_enabled=True,
        strict_readiness=True,
        redis_enabled=False,
        api_workers=2,
    )

    with pytest.raises(RuntimeError, match="API_WORKERS"):
        config.validate()


def test_config_rejects_nonlocal_storage_backend() -> None:
    config = Config(environment="test", storage_backend="s3")

    with pytest.raises(RuntimeError, match="STORAGE_BACKEND"):
        config.validate()


@pytest.mark.parametrize(
    ("field", "directory_name"),
    [
        ("upload_temp_dir", "uploads"),
        ("idempotency_dir", "idempotency"),
        ("chat_session_dir", "chat"),
    ],
)
def test_config_rejects_symlinked_state_directories(
    tmp_path: Path,
    field: str,
    directory_name: str,
) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    link = tmp_path / directory_name
    link.symlink_to(outside, target_is_directory=True)
    config = Config(environment="test")
    setattr(config, field, link)

    with pytest.raises(RuntimeError, match="must not be a symlink"):
        config.ensure_dirs()


@pytest.mark.asyncio
async def test_root_serves_standalone_frontend() -> None:
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as client:
        response = await client.get("/")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert '<div id="root"></div>' in response.text
    assert "script-src 'self'" in response.headers["content-security-policy"]


@pytest.mark.asyncio
async def test_frontend_assets_are_served_with_restrictive_headers() -> None:
    transport = httpx.ASGITransport(app=main.app)
    index = (main.FRONTEND_DIR / "index.html").read_text(encoding="utf-8")
    asset_path = index.split('src="', 1)[1].split('"', 1)[0]
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as client:
        asset = await client.get(asset_path)
        icon = await client.get("/favicon.svg")

    assert asset.status_code == 200
    assert asset.headers["x-content-type-options"] == "nosniff"
    assert "connect-src 'self'" in asset.headers["content-security-policy"]
    assert icon.status_code == 200
    assert icon.headers["content-type"].startswith("image/svg+xml")


@pytest.mark.asyncio
async def test_metadata_exposes_canonical_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        config_module,
        "_config",
        Config(environment="test", auth_required=False),
    )
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as client:
        response = await client.get("/v1/meta")

    body = response.json()
    assert body["name"] == "zcoder"
    assert body["version"] == "1.33.0"
    assert body["readiness"] == "/ready"
    assert response.headers["content-security-policy"] == (
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    )


@pytest.mark.asyncio
async def test_readiness_reports_component_state() -> None:
    main.app.state.components = {
        "redis": {"ready": True, "error": "disabled"},
        "http_client": {"ready": True, "error": None},
    }
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as client:
        response = await client.get("/ready")

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


@pytest.mark.parametrize(
    ("host", "workers", "message"),
    [
        ("0.0.0.0", 1, "127.0.0.1"),
        ("127.0.0.1", 2, "one worker"),
    ],
)
def test_run_server_cannot_override_production_bind_invariants(
    monkeypatch: pytest.MonkeyPatch,
    host: str,
    workers: int,
    message: str,
) -> None:
    config = Config(
        environment="production",
        auth_required=True,
        jwt_secret="a-production-secret-with-32-characters",
        cloudflare_access_required=True,
        cloudflare_access_team_domain="https://zc-team.cloudflareaccess.com",
        cloudflare_access_aud="a" * 64,
        rate_limit_enabled=True,
        strict_readiness=True,
        cors_origins=["https://zeaz.dev"],
        encryption_key=base64.b64encode(b"k" * 32).decode(),
        anthropic_api_key="test-provider-key",
    )
    monkeypatch.setattr(config_module, "_config", config)

    with pytest.raises(RuntimeError, match=message):
        main.run_server(host=host, workers=workers)
