"""Local no-cost runtime profile tests."""

from __future__ import annotations

from pathlib import Path

from app.local import LOCAL_DEFAULTS, apply_local_defaults

ROOT = Path(__file__).resolve().parents[1]


def _development_example() -> dict[str, str]:
    values: dict[str, str] = {}
    for line in (ROOT / ".env.example").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.startswith("#"):
            name, value = line.split("=", 1)
            values[name] = value
    return values


def test_local_defaults_disable_external_paid_dependencies(monkeypatch) -> None:
    for key in LOCAL_DEFAULTS:
        monkeypatch.delenv(key, raising=False)

    apply_local_defaults()

    assert LOCAL_DEFAULTS["STORAGE_BACKEND"] == "local"
    assert LOCAL_DEFAULTS["REDIS_ENABLED"] == "false"
    assert LOCAL_DEFAULTS["AUTH_REQUIRED"] == "false"
    assert LOCAL_DEFAULTS["PROTOBUF_ENABLED"] == "false"
    assert LOCAL_DEFAULTS["RATE_LIMIT_ENABLED"] == "false"


def test_local_launcher_defaults_match_development_example() -> None:
    example = _development_example()

    assert {name: example[name] for name in LOCAL_DEFAULTS} == LOCAL_DEFAULTS


def test_local_defaults_do_not_override_explicit_environment(monkeypatch) -> None:
    monkeypatch.setenv("API_PORT", "9123")
    apply_local_defaults()
    assert __import__("os").environ["API_PORT"] == "9123"
