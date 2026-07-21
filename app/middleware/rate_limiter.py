"""Per-subject rate limiting for the supported HTTP runtime."""

import hashlib
import json
import time
from collections import defaultdict
from typing import Any

from fastapi import Request, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.cache import get_cache


class TokenBucket:
    """Token bucket rate limiter implementation."""

    def __init__(self, capacity: int, refill_rate: float):
        self.capacity = capacity  # Max tokens
        self.refill_rate = refill_rate  # Tokens per second
        self.tokens: float = float(capacity)
        self.last_refill = time.time()

    def consume(self, tokens: int = 1) -> bool:
        """Try to consume tokens. Returns True if successful."""
        now = time.time()
        elapsed = now - self.last_refill

        # Refill tokens based on elapsed time
        self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_rate)
        self.last_refill = now

        if self.tokens >= tokens:
            self.tokens -= tokens
            return True
        return False


class RateLimitMiddleware:
    """FastAPI middleware for rate limiting."""

    EXEMPT_PATHS = frozenset({"/", "/ready", "/v1/wire/health/live"})

    def __init__(
        self,
        app: ASGIApp,
        requests_per_minute: int = 100,
        burst: int = 20,
        window_seconds: int = 60,
    ) -> None:
        self.app = app
        self.window_seconds = window_seconds
        self.bucket = TokenBucket(
            capacity=burst,
            refill_rate=requests_per_minute / window_seconds,
        )
        self.client_buckets: dict[str, TokenBucket] = defaultdict(
            lambda: TokenBucket(
                capacity=burst,
                refill_rate=requests_per_minute / window_seconds,
            )
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] in self.EXEMPT_PATHS:
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive=receive)
        access_claims = scope.get("state", {}).get("cloudflare_access", {})
        access_subject = (
            access_claims.get("sub") if isinstance(access_claims, dict) else None
        )
        if isinstance(access_subject, str) and access_subject:
            client_key = hashlib.sha256(access_subject.encode()).hexdigest()
        else:
            client_key = request.client.host if request.client else "unknown"
        allowed = True
        remaining = 0

        # Redis is authoritative in multi-replica deployments. The in-process
        # bucket is only a development fallback.
        from ..core.config import get_config

        cache = get_cache()
        config = get_config()
        if cache._connected and cache.redis_client is not None:
            if not await cache._check_circuit():
                response = Response(
                    status_code=503,
                    content=json.dumps({"error": "rate_limiter_unavailable"}),
                    media_type="application/json",
                )
                await response(scope, receive, send)
                return
            window = int(time.time() // self.window_seconds)
            key = f"rtl:http:{client_key}:{window}"
            try:
                count = int(await cache.redis_client.incr(key))
                if count == 1:
                    await cache.redis_client.expire(key, self.window_seconds + 1)
                cache._record_success()
                allowed = count <= self.bucket.capacity
                remaining = max(0, int(self.bucket.capacity) - count)
            except Exception:
                await cache._record_failure()
                response = Response(
                    status_code=503,
                    content=json.dumps({"error": "rate_limiter_unavailable"}),
                    media_type="application/json",
                )
                await response(scope, receive, send)
                return
        elif config.environment == "production" and config.redis_enabled:
            response = Response(
                status_code=503,
                content=json.dumps({"error": "rate_limiter_unavailable"}),
                media_type="application/json",
            )
            await response(scope, receive, send)
            return
        else:
            bucket = self.client_buckets[client_key]
            allowed = bucket.consume()
            remaining = int(bucket.tokens)

        if not allowed:
            response = Response(
                status_code=429,
                content=json.dumps(
                    {
                        "error": "rate_limit_exceeded",
                        "message": "Too many requests. Please slow down.",
                        "retry_after": self.window_seconds,
                    }
                ),
                media_type="application/json",
            )
            await response(scope, receive, send)
            return

        async def send_with_rate_limit_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.extend(
                    [
                        (b"x-ratelimit-limit", str(self.bucket.capacity).encode()),
                        (b"x-ratelimit-remaining", str(remaining).encode()),
                        (
                            b"x-ratelimit-reset",
                            str(int(time.time()) + self.window_seconds).encode(),
                        ),
                    ]
                )
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_rate_limit_headers)
