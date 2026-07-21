"""Optional local cache failure-boundary regression tests."""

from __future__ import annotations

import time
from typing import Any

import pytest

from app.core.cache import EnterpriseCache
from app.core.config import Config


class _FailingRedis:
    async def info(self, _section: str) -> dict[str, Any]:
        raise RuntimeError("redis://user:secret@127.0.0.1:6379")

    async def dbsize(self) -> int:
        return 0


@pytest.mark.asyncio
async def test_cache_health_redacts_redis_failure_details() -> None:
    cache = EnterpriseCache(Config(environment="test"))
    cache._connected = True
    cache.redis_client = _FailingRedis()  # type: ignore[assignment]

    health = await cache.health_check()

    assert health["redis_error"] == "unavailable"
    assert "secret" not in str(health)


@pytest.mark.asyncio
async def test_cache_circuit_stays_open_until_reset_window() -> None:
    cache = EnterpriseCache(Config(environment="test"))
    cache._circuit_threshold = 2

    await cache._record_failure()
    await cache._record_failure()

    assert cache._circuit_open is True
    assert await cache._check_circuit() is False

    cache._circuit_opened_at = time.monotonic() - cache._circuit_reset_time
    assert await cache._check_circuit() is True
    assert cache._circuit_half_open is True

    await cache._record_failure()
    assert cache._circuit_open is True
    assert cache._circuit_half_open is False


@pytest.mark.asyncio
async def test_cache_success_clears_transient_failures() -> None:
    cache = EnterpriseCache(Config(environment="test"))
    await cache._record_failure()

    cache._record_success()

    assert cache._circuit_failures == 0
    assert cache._circuit_open is False


@pytest.mark.asyncio
async def test_cache_rejects_explicit_nonpositive_ttl() -> None:
    cache = EnterpriseCache(Config(environment="test"))

    with pytest.raises(ValueError, match="TTL"):
        await cache.set("key", "value", ttl=0)
