"""Enforce the product dependency and packaging boundaries from ADR-001."""

import ast
import configparser
from pathlib import Path

from fastapi.routing import APIRoute

from app.main import app

ROOT = Path(__file__).resolve().parents[1]


def _import_roots(source_root: Path) -> set[str]:
    roots: set[str] = set()
    for path in source_root.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                roots.update(alias.name.partition(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                roots.add(node.module.partition(".")[0])
    return roots


def test_supported_api_is_independent_from_compatibility_surfaces() -> None:
    assert _import_roots(ROOT / "app").isdisjoint({"wire", "webapp"})


def test_compatibility_cli_is_independent_from_server_and_web_adapter() -> None:
    assert _import_roots(ROOT / "src" / "wire").isdisjoint({"app", "webapp"})


def test_runtime_package_manifest_excludes_agent_tooling() -> None:
    config = configparser.ConfigParser()
    config.read(ROOT / "setup.cfg")
    packages = set(config["options"]["packages"].split())

    assert {"app", "wire", "webapp"} <= packages
    assert not any(
        package == "agents"
        or package.startswith("agents.")
        or package == "zc"
        or package.startswith("zc.")
        for package in packages
    )


def test_console_commands_expose_cli_and_api_boundaries() -> None:
    config = configparser.ConfigParser()
    config.read(ROOT / "setup.cfg")
    entry_points = config["options.entry_points"]["console_scripts"]

    assert "zc = app.cli:cli" in entry_points
    assert "zcoder = app.cli:cli" in entry_points
    assert "zc-api = app.cli:cli" in entry_points
    assert "zc-legacy = wire.main:main" in entry_points


def test_generated_grpc_module_uses_package_relative_import() -> None:
    generated = (ROOT / "app/proto/wire_pb2_grpc.py").read_text(encoding="utf-8")

    assert "from . import wire_pb2 as wire__pb2" in generated
    assert "\nimport wire_pb2 as wire__pb2" not in generated


def test_every_mutating_http_route_has_application_authorization() -> None:
    routes: list[object] = []
    for candidate in app.routes:
        included = getattr(candidate, "original_router", None)
        routes.extend(included.routes if included is not None else [candidate])

    unprotected: list[str] = []
    for route in routes:
        if not isinstance(route, APIRoute):
            continue
        methods = set(route.methods or ())
        if not methods.intersection({"POST", "PUT", "PATCH", "DELETE"}):
            continue
        dependency_names: set[str] = set()
        stack = list(route.dependant.dependencies)
        while stack:
            dependency = stack.pop()
            dependency_names.add(
                getattr(
                    dependency.call,
                    "__name__",
                    type(dependency.call).__name__,
                )
            )
            stack.extend(dependency.dependencies)
        if "require_principal" not in dependency_names:
            unprotected.append(f"{','.join(sorted(methods))} {route.path}")

    assert unprotected == []


def test_operational_health_routes_require_application_authorization() -> None:
    routes: list[object] = []
    for candidate in app.routes:
        included = getattr(candidate, "original_router", None)
        routes.extend(included.routes if included is not None else [candidate])

    unprotected: list[str] = []
    for route in routes:
        if (
            not isinstance(route, APIRoute)
            or "health" not in route.path
            or route.path == "/v1/wire/health/live"
        ):
            continue
        dependency_names: set[str] = set()
        stack = list(route.dependant.dependencies)
        while stack:
            dependency = stack.pop()
            dependency_names.add(
                getattr(
                    dependency.call,
                    "__name__",
                    type(dependency.call).__name__,
                )
            )
            stack.extend(dependency.dependencies)
        if "require_principal" not in dependency_names:
            unprotected.append(route.path)

    assert unprotected == []


def test_every_v1_route_except_liveness_requires_application_authorization() -> None:
    routes: list[object] = []
    for candidate in app.routes:
        included = getattr(candidate, "original_router", None)
        routes.extend(included.routes if included is not None else [candidate])

    unprotected: list[str] = []
    for route in routes:
        if (
            not isinstance(route, APIRoute)
            or not route.path.startswith("/v1/")
            or route.path == "/v1/wire/health/live"
        ):
            continue
        dependency_names: set[str] = set()
        stack = list(route.dependant.dependencies)
        while stack:
            dependency = stack.pop()
            dependency_names.add(
                getattr(
                    getattr(dependency, "call", None),
                    "__name__",
                    "",
                )
            )
            stack.extend(dependency.dependencies)
        if "require_principal" not in dependency_names:
            unprotected.append(route.path)

    assert unprotected == []


def test_supported_core_has_no_unwired_mock_authorization_policy() -> None:
    assert not (ROOT / "app/models/rbac.py").exists()


def test_supported_core_has_no_unwired_latency_profiler() -> None:
    assert not (ROOT / "app/api/v1/middleware/latency_profiler.py").exists()


def test_living_architecture_describes_supported_runtime_persistence() -> None:
    architecture = (ROOT / "ARCHITECTURE.md").read_text(encoding="utf-8").replace("\n", " ")

    assert "local SQLite" in architecture
    assert "tenant-scoped atomic JSON" in architecture
    assert "There is no database" not in architecture
    assert "That legacy storage model does not define the canonical" in architecture
