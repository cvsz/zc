"""Cloudflare Access origin-verification regression tests."""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI, Request

import app.core.config as config_module
from app.core.cloudflare_access import (
    CloudflareAccessError,
    CloudflareAccessVerifier,
)
from app.core.config import Config
from app.middleware.cloudflare_access import CloudflareAccessMiddleware

TEAM_DOMAIN = "https://zeaz.cloudflareaccess.com"
AUDIENCE = "zc-access-audience"
KEY_ID = "test-key"


def _key_pair() -> tuple[rsa.RSAPrivateKey, dict[str, str]]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    numbers = private_key.public_key().public_numbers()
    jwk = {
        "kty": "RSA",
        "kid": KEY_ID,
        "use": "sig",
        "alg": "RS256",
        "n": jwt.utils.to_base64url_uint(numbers.n).decode("ascii"),
        "e": jwt.utils.to_base64url_uint(numbers.e).decode("ascii"),
    }
    return private_key, jwk


def _token(
    private_key: rsa.RSAPrivateKey,
    *,
    audience: str = AUDIENCE,
    issuer: str = TEAM_DOMAIN,
    expires_at: int | None = None,
) -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "sub": "access-user",
            "email": "operator@example.com",
            "aud": audience,
            "iss": issuer,
            "iat": now - 1,
            "exp": expires_at if expires_at is not None else now + 300,
        },
        private_key,
        algorithm="RS256",
        headers={"kid": KEY_ID},
    )


def _loader(
    jwk: dict[str, str],
) -> tuple[Callable[[], Awaitable[dict[str, Any]]], list[bool]]:
    calls: list[bool] = []

    async def load() -> dict[str, Any]:
        calls.append(True)
        return {"keys": [jwk]}

    return load, calls


def test_config_requires_complete_access_settings_when_enabled() -> None:
    config = Config(
        environment="production",
        auth_required=True,
        jwt_secret="production-test-secret-at-least-32-chars",
        cloudflare_access_required=True,
    )

    with pytest.raises(RuntimeError, match="TEAM_DOMAIN"):
        config.validate()


def test_config_rejects_non_cloudflare_team_domain() -> None:
    config = Config(
        environment="production",
        auth_required=True,
        jwt_secret="production-test-secret-at-least-32-chars",
        cloudflare_access_required=True,
        cloudflare_access_team_domain="https://attacker.example.com",
        cloudflare_access_aud=AUDIENCE,
    )

    with pytest.raises(ValueError, match="cloudflareaccess.com"):
        config.validate()


@pytest.mark.parametrize(
    "team_domain",
    [
        "https://user@zeaz.cloudflareaccess.com",
        "https://zeaz.cloudflareaccess.com:8443",
    ],
)
def test_verifier_rejects_credentialed_or_nonstandard_team_origins(
    team_domain: str,
) -> None:
    with pytest.raises(ValueError, match="cloudflareaccess.com"):
        CloudflareAccessVerifier(
            team_domain=team_domain,
            audience=AUDIENCE,
        )


@pytest.mark.asyncio
async def test_verifier_accepts_valid_access_assertion_and_caches_jwks() -> None:
    private_key, jwk = _key_pair()
    loader, calls = _loader(jwk)
    verifier = CloudflareAccessVerifier(
        team_domain=TEAM_DOMAIN,
        audience=AUDIENCE,
        jwks_loader=loader,
    )

    first = await verifier.verify(_token(private_key))
    second = await verifier.verify(_token(private_key))

    assert first["sub"] == second["sub"] == "access-user"
    assert first["email"] == "operator@example.com"
    assert len(calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("token_factory", "expected_error"),
    [
        (
            lambda key: _token(key, audience="wrong-audience"),
            "invalid assertion",
        ),
        (
            lambda key: _token(key, issuer="https://wrong.cloudflareaccess.com"),
            "invalid assertion",
        ),
        (
            lambda key: _token(key, expires_at=int(time.time()) - 60),
            "invalid assertion",
        ),
    ],
)
async def test_verifier_rejects_invalid_registered_claims(
    token_factory: Callable[[rsa.RSAPrivateKey], str],
    expected_error: str,
) -> None:
    private_key, jwk = _key_pair()
    loader, _calls = _loader(jwk)
    verifier = CloudflareAccessVerifier(
        team_domain=TEAM_DOMAIN,
        audience=AUDIENCE,
        jwks_loader=loader,
    )

    with pytest.raises(CloudflareAccessError, match=expected_error):
        await verifier.verify(token_factory(private_key))


@pytest.mark.asyncio
async def test_verifier_rejects_invalid_signature() -> None:
    _trusted_key, trusted_jwk = _key_pair()
    untrusted_key, _untrusted_jwk = _key_pair()
    loader, _calls = _loader(trusted_jwk)
    verifier = CloudflareAccessVerifier(
        team_domain=TEAM_DOMAIN,
        audience=AUDIENCE,
        jwks_loader=loader,
    )

    with pytest.raises(CloudflareAccessError, match="invalid assertion"):
        await verifier.verify(_token(untrusted_key))


def _middleware_app(config: Config) -> FastAPI:
    config_module._config = config
    test_app = FastAPI()
    test_app.add_middleware(CloudflareAccessMiddleware)

    @test_app.get("/protected")
    async def protected(request: Request) -> dict[str, Any]:
        return {
            "ok": True,
            "access_subject": getattr(request.state, "cloudflare_access", {}).get(
                "sub"
            ),
        }

    @test_app.get("/ready")
    async def ready() -> dict[str, str]:
        return {"status": "ready"}

    return test_app


@pytest.mark.asyncio
async def test_middleware_rejects_missing_assertion() -> None:
    config = Config(
        environment="test",
        auth_required=True,
        cloudflare_access_required=True,
        cloudflare_access_team_domain=TEAM_DOMAIN,
        cloudflare_access_aud=AUDIENCE,
    )
    test_app = _middleware_app(config)
    transport = httpx.ASGITransport(app=test_app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/protected")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == ("cloudflare_access_assertion_required")
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.asyncio
async def test_middleware_passes_verified_claims_to_request_state(
    monkeypatch,
) -> None:
    class AcceptingVerifier:
        async def verify(self, token: str) -> dict[str, str]:
            assert token == "valid-access-token"
            return {"sub": "access-user"}

    monkeypatch.setattr(
        CloudflareAccessMiddleware,
        "_get_verifier",
        lambda *_args, **_kwargs: AcceptingVerifier(),
    )
    config = Config(
        environment="test",
        auth_required=True,
        cloudflare_access_required=True,
        cloudflare_access_team_domain=TEAM_DOMAIN,
        cloudflare_access_aud=AUDIENCE,
    )
    test_app = _middleware_app(config)
    transport = httpx.ASGITransport(app=test_app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/protected",
            headers={"Cf-Access-Jwt-Assertion": "valid-access-token"},
        )

    assert response.status_code == 200
    assert response.json() == {"ok": True, "access_subject": "access-user"}


@pytest.mark.asyncio
async def test_local_readiness_does_not_require_access_assertion() -> None:
    config = Config(
        environment="test",
        auth_required=True,
        cloudflare_access_required=True,
        cloudflare_access_team_domain=TEAM_DOMAIN,
        cloudflare_access_aud=AUDIENCE,
    )
    test_app = _middleware_app(config)
    transport = httpx.ASGITransport(app=test_app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


@pytest.mark.asyncio
async def test_development_mode_bypasses_cloudflare_access() -> None:
    config = Config(
        environment="development",
        auth_required=False,
        cloudflare_access_required=False,
    )
    test_app = _middleware_app(config)
    transport = httpx.ASGITransport(app=test_app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/protected")

    assert response.status_code == 200
    assert response.json() == {"ok": True, "access_subject": None}
