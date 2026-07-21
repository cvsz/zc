"""Regression checks for scoped lint and security policy."""

import tomllib
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYPROJECT = ROOT / "pyproject.toml"


def _config() -> dict:
    with PYPROJECT.open("rb") as config_file:
        return tomllib.load(config_file)


def test_ruff_has_no_repository_wide_ignores() -> None:
    lint = _config()["tool"]["ruff"]["lint"]

    assert not lint.get("ignore")
    assert lint["per-file-ignores"]


def test_supported_api_does_not_inherit_legacy_correctness_waivers() -> None:
    per_file = _config()["tool"]["ruff"]["lint"]["per-file-ignores"]
    app_waivers = set(per_file["app/**/*.py"])

    assert app_waivers == {"E501"}
    assert {"E701", "E702", "F401", "F841", "B007"} <= set(per_file["src/wire/**/*.py"])


def test_bandit_has_no_global_test_skips() -> None:
    bandit = _config()["tool"]["bandit"]

    assert not bandit.get("skips")


def test_only_intentional_scripts_are_executable() -> None:
    output = subprocess.run(
        ["git", "ls-files"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    unexpected: list[str] = []
    for path in output.splitlines():
        file_path = ROOT / path
        if not file_path.exists() or not file_path.stat().st_mode & 0o111:
            continue
        if (
            path.startswith("scripts/")
            or "/scripts/" in path
            or "/bin/" in path
            or path in {"build.sh", "setup.sh"}
        ):
            continue
        unexpected.append(path)

    assert unexpected == []


def test_generated_virtual_environments_are_not_tracked() -> None:
    output = subprocess.run(
        ["git", "ls-files", "--", ".venv", ".web-venv"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout

    assert output == ""
