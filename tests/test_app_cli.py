"""Tests for the canonical zc server and local token operator CLI."""

from __future__ import annotations

import jwt
import pytest

import app.core.config as config_module
from app import cli as app_cli
from app.core.auth import create_application_token
from app.core.config import Config


@pytest.fixture
def token_config(monkeypatch: pytest.MonkeyPatch) -> Config:
    config = Config(
        environment="test",
        jwt_secret="a-local-operator-secret-over-32-characters",
        jwt_issuer="zc-test",
        jwt_audience="zc-test-api",
    )
    monkeypatch.setattr(config_module, "_config", config)
    return config


def test_operator_cli_creates_scoped_application_token(
    token_config: Config,
    capsys: pytest.CaptureFixture[str],
) -> None:
    app_cli.cli(
        [
            "token",
            "--subject",
            "operator@example.com",
            "--tenant",
            "tenant-a",
            "--role",
            "admin",
            "--role",
            "viewer",
            "--expires-in",
            "300",
        ]
    )

    captured = capsys.readouterr()
    token = captured.out.strip()
    claims = jwt.decode(
        token,
        token_config.jwt_secret,
        algorithms=["HS256"],
        issuer=token_config.jwt_issuer,
        audience=token_config.jwt_audience,
    )
    assert claims["sub"] == "operator@example.com"
    assert claims["tenant_id"] == "tenant-a"
    assert claims["roles"] == ["admin", "viewer"]
    assert "Sensitive application token" in captured.err


def test_token_helper_rejects_unsafe_tenant(token_config: Config) -> None:
    with pytest.raises(ValueError, match="tenant_id"):
        create_application_token(
            "operator",
            "../../other-tenant",
            ["admin"],
        )


def test_token_helper_rejects_excessive_lifetime(token_config: Config) -> None:
    with pytest.raises(ValueError, match="expiry"):
        create_application_token(
            "operator",
            "tenant-a",
            ["admin"],
            expiry_seconds=86401,
        )


def test_token_helper_rejects_zero_lifetime(token_config: Config) -> None:
    with pytest.raises(ValueError, match="expiry"):
        create_application_token(
            "operator",
            "tenant-a",
            ["admin"],
            expiry_seconds=0,
        )


def test_cli_loads_dotenv_without_overriding_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[bool] = []
    monkeypatch.setattr(
        app_cli,
        "load_dotenv",
        lambda *, override: calls.append(override),
    )
    monkeypatch.setattr("app.main.run_server", lambda **_kwargs: None)

    app_cli.cli([])

    assert calls == [False]
