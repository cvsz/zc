"""Durable idempotency regression tests for mutating API requests."""

from __future__ import annotations

import asyncio
import stat
from pathlib import Path

import httpx
import pytest
from fastapi import Depends, FastAPI, Request

import app.core.config as config_module
from app.core.auth import (
    Principal,
    create_application_token,
    create_short_lived_token,
    require_roles,
)
from app.core.config import Config
from app.middleware.idempotency import IdempotencyMiddleware


def _app(directory: Path, counter: dict[str, int]) -> FastAPI:
    app = FastAPI()

    @app.post("/mutate")
    async def mutate(request: Request) -> dict[str, object]:
        counter["calls"] += 1
        await asyncio.sleep(0.01)
        return {"call": counter["calls"], "body": (await request.body()).decode()}

    config = Config(
        environment="test",
        auth_required=False,
        idempotency_dir=directory,
        idempotency_ttl_seconds=3600,
        idempotency_max_response_bytes=1024,
    )
    app.add_middleware(IdempotencyMiddleware, config=config)
    return app


def _authenticated_app(
    directory: Path,
    counter: dict[str, int],
    monkeypatch: pytest.MonkeyPatch,
) -> FastAPI:
    config = Config(
        environment="test",
        auth_required=True,
        jwt_secret="an-idempotency-test-secret-over-32-characters",
        idempotency_dir=directory,
    )
    monkeypatch.setattr(config_module, "_config", config)
    app = FastAPI()

    @app.post("/mutate")
    async def mutate() -> dict[str, int]:
        counter["calls"] += 1
        return {"call": counter["calls"]}

    app.add_middleware(IdempotencyMiddleware, config=config)
    return app


@pytest.mark.asyncio
async def test_mutation_requires_idempotency_key(tmp_path: Path) -> None:
    transport = httpx.ASGITransport(app=_app(tmp_path, {"calls": 0}))
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.post("/mutate", content="payload")

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "idempotency_key_required"


@pytest.mark.asyncio
async def test_same_key_replays_without_reexecuting(tmp_path: Path) -> None:
    counter = {"calls": 0}
    transport = httpx.ASGITransport(app=_app(tmp_path, counter))
    headers = {"Idempotency-Key": "request-key-0001"}
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        first = await client.post("/mutate", content="payload", headers=headers)
        replay = await client.post("/mutate", content="payload", headers=headers)

    assert first.status_code == replay.status_code == 200
    assert first.json() == replay.json() == {"call": 1, "body": "payload"}
    assert first.headers["idempotency-replayed"] == "false"
    assert replay.headers["idempotency-replayed"] == "true"
    assert counter["calls"] == 1


@pytest.mark.asyncio
async def test_same_key_with_different_body_conflicts(tmp_path: Path) -> None:
    transport = httpx.ASGITransport(app=_app(tmp_path, {"calls": 0}))
    headers = {"Idempotency-Key": "request-key-0002"}
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        await client.post("/mutate", content="first", headers=headers)
        conflict = await client.post("/mutate", content="second", headers=headers)

    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "idempotency_key_conflict"


@pytest.mark.asyncio
async def test_response_replays_after_process_restart(tmp_path: Path) -> None:
    headers = {"Idempotency-Key": "request-key-0003"}
    first_counter = {"calls": 0}
    first_transport = httpx.ASGITransport(app=_app(tmp_path, first_counter))
    async with httpx.AsyncClient(
        transport=first_transport,
        base_url="http://test",
    ) as client:
        first = await client.post("/mutate", content="payload", headers=headers)

    second_counter = {"calls": 0}
    second_transport = httpx.ASGITransport(app=_app(tmp_path, second_counter))
    async with httpx.AsyncClient(
        transport=second_transport,
        base_url="http://test",
    ) as client:
        replay = await client.post("/mutate", content="payload", headers=headers)

    assert replay.json() == first.json()
    assert replay.headers["idempotency-replayed"] == "true"
    assert second_counter["calls"] == 0
    cache_file = next(tmp_path.glob("*.json"))
    assert stat.S_IMODE(cache_file.stat().st_mode) == 0o600


@pytest.mark.asyncio
async def test_concurrent_duplicate_executes_once(tmp_path: Path) -> None:
    counter = {"calls": 0}
    transport = httpx.ASGITransport(app=_app(tmp_path, counter))
    headers = {"Idempotency-Key": "request-key-0004"}
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        first, second = await asyncio.gather(
            client.post("/mutate", content="payload", headers=headers),
            client.post("/mutate", content="payload", headers=headers),
        )

    assert first.status_code == second.status_code == 200
    assert counter["calls"] == 1
    assert {
        first.headers["idempotency-replayed"],
        second.headers["idempotency-replayed"],
    } == {
        "false",
        "true",
    }


@pytest.mark.asyncio
async def test_authenticated_mutation_rejects_missing_bearer(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    counter = {"calls": 0}
    transport = httpx.ASGITransport(
        app=_authenticated_app(tmp_path, counter, monkeypatch)
    )
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.post(
            "/mutate",
            headers={"Idempotency-Key": "request-key-0005"},
        )

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert counter["calls"] == 0


@pytest.mark.asyncio
async def test_idempotency_key_is_scoped_to_verified_identity(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    counter = {"calls": 0}
    app = _authenticated_app(tmp_path, counter, monkeypatch)
    first_token = create_short_lived_token("tenant-a", "developer")
    second_token = create_short_lived_token("tenant-b", "developer")
    key = "request-key-0006"
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        first = await client.post(
            "/mutate",
            headers={
                "Authorization": f"Bearer {first_token}",
                "Idempotency-Key": key,
            },
        )
        second = await client.post(
            "/mutate",
            headers={
                "Authorization": f"Bearer {second_token}",
                "Idempotency-Key": key,
            },
        )

    assert first.json() == {"call": 1}
    assert second.json() == {"call": 2}
    assert counter["calls"] == 2


@pytest.mark.asyncio
async def test_idempotency_replay_cannot_cross_application_role_scope(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = Config(
        environment="test",
        auth_required=True,
        jwt_secret="an-idempotency-test-secret-over-32-characters",
        idempotency_dir=tmp_path,
    )
    monkeypatch.setattr(config_module, "_config", config)
    counter = {"calls": 0}
    app = FastAPI()

    @app.post("/admin")
    async def admin_mutation(
        _principal: Principal = Depends(require_roles("admin")),
    ) -> dict[str, int]:
        counter["calls"] += 1
        return {"call": counter["calls"]}

    app.add_middleware(IdempotencyMiddleware, config=config)
    admin_token = create_application_token(
        "operator",
        "tenant-a",
        ["admin"],
    )
    viewer_token = create_application_token(
        "operator",
        "tenant-a",
        ["viewer"],
    )
    key = "request-key-role-scope"
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        allowed = await client.post(
            "/admin",
            headers={
                "Authorization": f"Bearer {admin_token}",
                "Idempotency-Key": key,
            },
        )
        denied = await client.post(
            "/admin",
            headers={
                "Authorization": f"Bearer {viewer_token}",
                "Idempotency-Key": key,
            },
        )

    assert allowed.status_code == 200
    assert denied.status_code == 403
    assert counter["calls"] == 1
