"""Executable configuration contract and deployment-example parity."""

from __future__ import annotations

import ast
import re
from pathlib import Path

from app.core.config import APP_NAME, APP_VERSION, Config

ROOT = Path(__file__).resolve().parents[1]
CONFIG_SOURCE = ROOT / "app/core/config.py"
COMPATIBILITY_ONLY = {"ZC_API_TOKEN", "ZC_API_URL"}


def _runtime_environment_names() -> set[str]:
    tree = ast.parse(CONFIG_SOURCE.read_text(encoding="utf-8"))
    names: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not node.args:
            continue
        first = node.args[0]
        if not isinstance(first, ast.Constant) or not isinstance(first.value, str):
            continue
        if (
            isinstance(node.func, ast.Attribute)
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "os"
            and node.func.attr == "getenv"
        ) or (isinstance(node.func, ast.Name) and node.func.id == "_env_bool"):
            names.add(first.value)
    return names


def _example_environment_names(path: Path) -> set[str]:
    names: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^([A-Z][A-Z0-9_]*)=", line)
        if match:
            names.add(match.group(1))
    return names


def test_environment_examples_cover_every_runtime_setting() -> None:
    expected = _runtime_environment_names()

    development = _example_environment_names(ROOT / ".env.example")
    production = _example_environment_names(ROOT / ".env.production.example")

    assert development - COMPATIBILITY_ONLY == expected
    assert production == expected


def test_environment_cannot_override_canonical_identity(
    monkeypatch,
) -> None:
    monkeypatch.setenv("APP_NAME", "spoofed")
    monkeypatch.setenv("APP_VERSION", "999.0.0")

    config = Config.from_env()

    assert config.app_name == APP_NAME
    assert config.version == APP_VERSION
