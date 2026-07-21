"""Rate-limiter identity scoping regression tests."""

from __future__ import annotations

from typing import Any

import pytest

import app.core.config as config_module
import app.middleware.rate_limiter as rate_limiter_module
from app.core.cache import EnterpriseCache
from app.core.config import Config
from app.middleware.rate_limiter import RateLimitMiddleware


async def _status(
    middleware: RateLimitMiddleware,
    subject: str,
) -> int:
    messages: list[dict[str, Any]] = []
    scope: dict[str, Any] = {
        "type": "http",
        "method": "GET",
        "path": "/v1/meta",
        "headers": [],
        "client": ("127.0.0.1", 12345),
        "state": {"cloudflare_access": {"sub": subject}},
    }

    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: dict[str, Any]) -> None:
        messages.append(message)

    await middleware(scope, receive, send)  # type: ignore[arg-type]
    start = next(
        message for message in messages if message["type"] == "http.response.start"
    )
    return int(start["status"])


@pytest.mark.asyncio
async def test_rate_limit_is_scoped_to_verified_access_subject(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = Config(environment="test", redis_enabled=False)
    monkeypatch.setattr(config_module, "_config", config)

    async def app(_scope: Any, _receive: Any, send: Any) -> None:
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    middleware = RateLimitMiddleware(app, requests_per_minute=1, burst=1)

    assert await _status(middleware, "user-a") == 200
    assert await _status(middleware, "user-a") == 429
    assert await _status(middleware, "user-b") == 200


@pytest.mark.asyncio
async def test_authoritative_redis_failure_returns_sanitized_503(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FailingRedis:
        async def incr(self, _key: str) -> int:
            raise RuntimeError("redis://user:secret@127.0.0.1:6379")

    config = Config(
        environment="test",
        redis_enabled=True,
    )
    cache = EnterpriseCache(config)
    cache._connected = True
    cache.redis_client = FailingRedis()  # type: ignore[assignment]
    monkeypatch.setattr(config_module, "_config", config)
    monkeypatch.setattr(rate_limiter_module, "get_cache", lambda: cache)

    async def app(_scope: Any, _receive: Any, send: Any) -> None:
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    middleware = RateLimitMiddleware(app, requests_per_minute=1, burst=1)
    messages: list[dict[str, Any]] = []
    scope: dict[str, Any] = {
        "type": "http",
        "method": "GET",
        "path": "/v1/meta",
        "headers": [],
        "client": ("127.0.0.1", 12345),
        "state": {"cloudflare_access": {"sub": "user-a"}},
    }

    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: dict[str, Any]) -> None:
        messages.append(message)

    await middleware(scope, receive, send)  # type: ignore[arg-type]

    start = next(
        message for message in messages if message["type"] == "http.response.start"
    )
    body = next(
        message["body"]
        for message in messages
        if message["type"] == "http.response.body"
    )
    assert start["status"] == 503
    assert b"rate_limiter_unavailable" in body
    assert b"secret" not in body
    assert cache._circuit_failures == 1
