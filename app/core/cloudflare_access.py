"""Cloudflare Access JWT verification for the public local origin."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import urlparse

import jwt

from .http_client import get_http_client

JWKSLoader = Callable[[], Awaitable[dict[str, Any]]]


class CloudflareAccessError(RuntimeError):
    """Raised when a Cloudflare Access assertion cannot be trusted."""


class CloudflareAccessVerifier:
    """Verify Access assertions against a cached account JWKS."""

    def __init__(
        self,
        *,
        team_domain: str,
        audience: str,
        cache_seconds: int = 300,
        jwks_loader: JWKSLoader | None = None,
    ) -> None:
        parsed = urlparse(team_domain)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or not parsed.hostname.endswith(".cloudflareaccess.com")
            or parsed.username is not None
            or parsed.password is not None
            or parsed.port not in {None, 443}
            or parsed.path not in {"", "/"}
            or parsed.params
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError(
                "Cloudflare Access team domain must be an HTTPS "
                "*.cloudflareaccess.com origin"
            )
        if not audience.strip():
            raise ValueError("Cloudflare Access audience must not be empty")
        if cache_seconds <= 0:
            raise ValueError("Cloudflare Access JWKS cache duration must be positive")

        self.team_domain = team_domain.rstrip("/")
        self.audience = audience
        self.cache_seconds = cache_seconds
        self._jwks_loader = jwks_loader or self._fetch_jwks
        self._jwks: dict[str, Any] | None = None
        self._jwks_expires_at = 0.0
        self._jwks_lock = asyncio.Lock()

    async def verify(self, token: str) -> dict[str, Any]:
        """Return verified claims or raise a sanitized verification error."""
        if not token:
            raise CloudflareAccessError("missing assertion")
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as exc:
            raise CloudflareAccessError("invalid assertion") from exc
        if header.get("alg") != "RS256" or not isinstance(header.get("kid"), str):
            raise CloudflareAccessError("invalid assertion")

        key = await self._key_for_id(header["kid"], refresh=False)
        if key is None:
            key = await self._key_for_id(header["kid"], refresh=True)
        if key is None:
            raise CloudflareAccessError("invalid assertion")

        try:
            claims = jwt.decode(
                token,
                key=key,
                algorithms=["RS256"],
                audience=self.audience,
                issuer=self.team_domain,
                options={"require": ["aud", "exp", "iat", "iss", "sub"]},
            )
        except jwt.PyJWTError as exc:
            raise CloudflareAccessError("invalid assertion") from exc
        return dict(claims)

    async def _key_for_id(self, key_id: str, *, refresh: bool) -> Any | None:
        jwks = await self._get_jwks(force_refresh=refresh)
        for candidate in jwks.get("keys", []):
            if (
                isinstance(candidate, dict)
                and candidate.get("kid") == key_id
                and candidate.get("kty") == "RSA"
                and candidate.get("alg", "RS256") == "RS256"
                and candidate.get("use", "sig") == "sig"
            ):
                try:
                    return jwt.PyJWK.from_dict(candidate, algorithm="RS256").key
                except (jwt.PyJWTError, ValueError, TypeError):
                    return None
        return None

    async def _get_jwks(self, *, force_refresh: bool) -> dict[str, Any]:
        now = time.monotonic()
        if not force_refresh and self._jwks and now < self._jwks_expires_at:
            return self._jwks

        async with self._jwks_lock:
            now = time.monotonic()
            if not force_refresh and self._jwks and now < self._jwks_expires_at:
                return self._jwks
            try:
                payload = await self._jwks_loader()
            except Exception as exc:
                raise CloudflareAccessError("verification unavailable") from exc
            if not isinstance(payload, dict) or not isinstance(
                payload.get("keys"), list
            ):
                raise CloudflareAccessError("verification unavailable")
            self._jwks = payload
            self._jwks_expires_at = now + self.cache_seconds
            return payload

    async def _fetch_jwks(self) -> dict[str, Any]:
        response = await get_http_client().get(
            f"{self.team_domain}/cdn-cgi/access/certs",
            timeout=10,
            max_retries=1,
            max_response_bytes=256 * 1024,
        )
        if response.status != 200:
            raise CloudflareAccessError("verification unavailable")
        payload = response.json()
        if not isinstance(payload, dict):
            raise CloudflareAccessError("verification unavailable")
        return payload


__all__ = [
    "CloudflareAccessError",
    "CloudflareAccessVerifier",
    "JWKSLoader",
]
