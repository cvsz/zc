"""ASGI enforcement for Cloudflare Access assertions."""

from __future__ import annotations

import json

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from ..core.cloudflare_access import (
    CloudflareAccessError,
    CloudflareAccessVerifier,
)
from ..core.config import get_config


class CloudflareAccessMiddleware:
    """Fail closed when the public origin lacks a valid Access assertion."""

    HEALTH_PATHS = frozenset({"/ready", "/v1/wire/health/live"})

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self._verifier: CloudflareAccessVerifier | None = None
        self._verifier_key: tuple[str, str, int] | None = None

    async def __call__(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        config = get_config()
        if (
            not config.cloudflare_access_required
            or scope.get("path") in self.HEALTH_PATHS
        ):
            await self.app(scope, receive, send)
            return

        verifier = self._get_verifier(
            team_domain=config.cloudflare_access_team_domain or "",
            audience=config.cloudflare_access_aud or "",
            cache_seconds=config.cloudflare_access_jwks_cache_seconds,
        )
        assertion = self._header(scope, b"cf-access-jwt-assertion")
        if not assertion:
            await self._reject(send, "cloudflare_access_assertion_required")
            return
        try:
            claims = await verifier.verify(assertion)
        except CloudflareAccessError:
            await self._reject(send, "cloudflare_access_assertion_invalid")
            return

        state = scope.setdefault("state", {})
        state["cloudflare_access"] = claims
        await self.app(scope, receive, send)

    def _get_verifier(
        self,
        *,
        team_domain: str,
        audience: str,
        cache_seconds: int,
    ) -> CloudflareAccessVerifier:
        key = (team_domain, audience, cache_seconds)
        if self._verifier is None or self._verifier_key != key:
            self._verifier = CloudflareAccessVerifier(
                team_domain=team_domain,
                audience=audience,
                cache_seconds=cache_seconds,
            )
            self._verifier_key = key
        return self._verifier

    @staticmethod
    def _header(scope: Scope, name: bytes) -> str | None:
        for raw_name, raw_value in scope.get("headers", []):
            if raw_name.lower() == name:
                try:
                    value = raw_value.decode("ascii").strip()
                except UnicodeDecodeError:
                    return None
                return value or None
        return None

    @staticmethod
    async def _reject(send: Send, code: str) -> None:
        body = json.dumps(
            {"error": {"code": code, "message": "Cloudflare Access denied request."}},
            separators=(",", ":"),
        ).encode("utf-8")
        headers: list[tuple[bytes, bytes]] = [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode("ascii")),
            (b"cache-control", b"no-store"),
        ]
        start: Message = {
            "type": "http.response.start",
            "status": 401,
            "headers": headers,
        }
        await send(start)
        await send({"type": "http.response.body", "body": body})


__all__ = ["CloudflareAccessMiddleware"]
