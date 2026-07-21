"""Authentication and production configuration regression tests."""

from __future__ import annotations

import base64

import blake3
import httpx
import jwt
import pytest
from fastapi import FastAPI

import app.core.config as config_module
from app.api.v1.routes import router
from app.core.auth import create_short_lived_token, verify_token
from app.core.config import Config


def _production_config(**overrides: object) -> Config:
    values: dict[str, object] = {
        "environment": "production",
        "auth_required": True,
        "jwt_secret": "a-production-secret-with-32-characters",
        "cloudflare_access_required": True,
        "cloudflare_access_team_domain": ("https://zc-team.cloudflareaccess.com"),
        "cloudflare_access_aud": "a" * 64,
        "rate_limit_enabled": True,
        "strict_readiness": True,
        "cors_origins": ["https://zeaz.dev"],
        "encryption_key": base64.b64encode(b"k" * 32).decode(),
        "anthropic_api_key": "test-provider-key",
    }
    values.update(overrides)
    return Config(**values)  # type: ignore[arg-type]


@pytest.fixture
def secure_config(tmp_path, monkeypatch) -> Config:
    config = Config(
        environment="test",
        redis_enabled=False,
        protobuf_enabled=False,
        upload_temp_dir=tmp_path,
        storage_backend="local",
        jwt_secret="a-test-secret-with-sufficient-entropy",
        auth_required=True,
        rate_limit_enabled=False,
    )
    monkeypatch.setattr(config_module, "_config", config)
    return config


@pytest.mark.asyncio
async def test_upload_endpoint_requires_bearer_token(secure_config: Config) -> None:
    app = FastAPI()
    app.include_router(router)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/v1/wire/upload/init", json={})

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.asyncio
async def test_viewer_cannot_create_upload(secure_config: Config) -> None:
    app = FastAPI()
    app.include_router(router)
    token = create_short_lived_token("tenant-a", "viewer")
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/wire/upload/init",
            json={"file_id": "file-1", "file_name": "x", "total_size": 4},
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_authenticated_malformed_upload_returns_400(
    secure_config: Config,
) -> None:
    app = FastAPI()
    app.include_router(router)
    token = create_short_lived_token("tenant-a", "developer")
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/wire/upload/init",
            json={},
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 400
    assert response.json()["detail"].startswith("Missing required fields")


@pytest.mark.asyncio
async def test_authenticated_tenant_can_upload_chunk_and_read_progress(
    secure_config: Config,
) -> None:
    app = FastAPI()
    app.include_router(router)
    token = create_short_lived_token("tenant-a", "developer")
    authorization = {"Authorization": f"Bearer {token}"}
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        initialized = await client.post(
            "/v1/wire/upload/init",
            json={"file_id": "file-1", "file_name": "x", "total_size": 4},
            headers=authorization,
        )
        session_id = initialized.json()["session_id"]
        chunk = b"data"
        uploaded = await client.post(
            "/v1/wire/upload/chunk",
            content=chunk,
            headers={
                **authorization,
                "X-Upload-Session": session_id,
                "X-Chunk-Index": "0",
                "X-Chunk-Hash": blake3.blake3(chunk).hexdigest(),
            },
        )

    assert initialized.status_code == 200
    assert uploaded.status_code == 200
    assert uploaded.json()["progress"]["status"] == "completed"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("extra_headers", "body", "expected_detail"),
    [
        ({}, b"data", "Missing chunk_index"),
        (
            {
                "X-Chunk-Index": "0",
                "X-Chunk-Hash": blake3.blake3(b"extra").hexdigest(),
            },
            b"extra",
            "Chunk body exceeds the expected size",
        ),
    ],
)
async def test_raw_chunk_rejects_incomplete_or_oversized_input(
    secure_config: Config,
    extra_headers: dict[str, str],
    body: bytes,
    expected_detail: str,
) -> None:
    app = FastAPI()
    app.include_router(router)
    token = create_short_lived_token("tenant-a", "developer")
    authorization = {"Authorization": f"Bearer {token}"}
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        initialized = await client.post(
            "/v1/wire/upload/init",
            json={"file_id": "bounded-file", "file_name": "x", "total_size": 4},
            headers=authorization,
        )
        response = await client.post(
            "/v1/wire/upload/chunk",
            content=body,
            headers={
                **authorization,
                "X-Upload-Session": initialized.json()["session_id"],
                **extra_headers,
            },
        )

    assert response.status_code == 400
    assert response.json() == {"detail": expected_detail}


@pytest.mark.asyncio
async def test_missing_upload_progress_returns_404(secure_config: Config) -> None:
    app = FastAPI()
    app.include_router(router)
    token = create_short_lived_token("tenant-a", "viewer")
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/v1/wire/upload/progress/sess_missing",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 404
    assert response.json() == {"detail": "Upload session not found"}


@pytest.mark.asyncio
async def test_invalid_upload_progress_identifier_returns_400(
    secure_config: Config,
) -> None:
    app = FastAPI()
    app.include_router(router)
    token = create_short_lived_token("tenant-a", "viewer")
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/v1/wire/upload/progress/invalid",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid upload session identifier"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path",
    ["/v1/wire/health/ready", "/v1/wire/health/full"],
)
async def test_operational_health_requires_application_token(
    secure_config: Config,
    path: str,
) -> None:
    app = FastAPI()
    app.include_router(router)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(path)

    assert response.status_code == 401


def test_production_config_requires_jwt_secret(tmp_path) -> None:
    config = Config(
        environment="production",
        auth_required=True,
        jwt_secret=None,
        upload_temp_dir=tmp_path,
    )
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        config.validate()


def test_unknown_environment_cannot_bypass_production_validation(tmp_path) -> None:
    config = Config(
        environment="prodution",
        auth_required=False,
        api_host="0.0.0.0",
        upload_temp_dir=tmp_path,
    )

    with pytest.raises(RuntimeError, match="ENVIRONMENT"):
        config.validate()


def test_grpc_cannot_bind_outside_loopback(tmp_path) -> None:
    config = Config(
        environment="development",
        auth_required=False,
        api_host="0.0.0.0",
        protobuf_enabled=True,
        upload_temp_dir=tmp_path,
    )

    with pytest.raises(RuntimeError, match="gRPC"):
        config.validate()


def test_grpc_requires_an_available_adjacent_port(tmp_path) -> None:
    config = Config(
        environment="development",
        auth_required=False,
        api_port=65535,
        protobuf_enabled=True,
        upload_temp_dir=tmp_path,
    )

    with pytest.raises(RuntimeError, match="next port"):
        config.validate()


def test_production_config_requires_embedded_litellm(tmp_path) -> None:
    config = _production_config(
        upload_temp_dir=tmp_path,
        ai_provider="anthropic",
    )

    with pytest.raises(RuntimeError, match="litellm"):
        config.validate()


def test_production_config_rejects_remote_redis(tmp_path) -> None:
    config = _production_config(
        upload_temp_dir=tmp_path,
        redis_enabled=True,
        redis_url="rediss://paid.example.com:6379",
    )

    with pytest.raises(RuntimeError, match="loopback"):
        config.validate()


def test_production_config_caps_public_request_size(tmp_path) -> None:
    config = _production_config(
        upload_temp_dir=tmp_path,
        max_message_size=91 * 1024 * 1024,
    )

    with pytest.raises(RuntimeError, match="90 MiB"):
        config.validate()


@pytest.mark.parametrize(
    ("field", "message"),
    [
        ("api_timeout", "API_TIMEOUT"),
        ("redis_pool_size", "REDIS_POOL_SIZE"),
        ("redis_ttl_default", "REDIS_TTL_DEFAULT"),
    ],
)
def test_config_rejects_nonpositive_runtime_tuning(
    tmp_path,
    field: str,
    message: str,
) -> None:
    config = Config(
        environment="test",
        upload_temp_dir=tmp_path,
        **{field: 0},
    )

    with pytest.raises(RuntimeError, match=message):
        config.validate()


def test_application_jwt_rejects_wrong_audience(secure_config: Config) -> None:
    token = jwt.encode(
        {
            "sub": "tenant-a",
            "tenant_id": "tenant-a",
            "roles": ["viewer"],
            "iss": secure_config.jwt_issuer,
            "aud": "wrong-audience",
            "iat": 1_700_000_000,
            "exp": 4_000_000_000,
        },
        secure_config.jwt_secret,
        algorithm="HS256",
    )

    assert verify_token(token) is None


@pytest.mark.parametrize(
    ("tenant_id", "roles"),
    [
        ("../tenant-a", ["viewer"]),
        ("tenant:a", ["viewer"]),
        ("tenant-a", ["unknown"]),
        ("tenant-a", []),
    ],
)
def test_application_jwt_rejects_unsafe_identity_claims(
    secure_config: Config,
    tenant_id: str,
    roles: list[str],
) -> None:
    token = jwt.encode(
        {
            "sub": "operator@example.com",
            "tenant_id": tenant_id,
            "roles": roles,
            "iss": secure_config.jwt_issuer,
            "aud": secure_config.jwt_audience,
            "iat": 1_700_000_000,
            "exp": 4_000_000_000,
        },
        secure_config.jwt_secret,
        algorithm="HS256",
    )

    assert verify_token(token) is None


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("api_host", "0.0.0.0", "API_HOST"),
        ("api_workers", 2, "API_WORKERS"),
        ("cors_origins", ["*"], "CORS_ORIGINS"),
        ("cors_origins", ["http://zeaz.dev"], "CORS_ORIGINS"),
    ],
)
def test_production_config_rejects_unsafe_public_origin_settings(
    field: str,
    value: object,
    message: str,
) -> None:
    config = Config(
        environment="production",
        auth_required=True,
        jwt_secret="a-production-secret-with-32-characters",
    )
    setattr(config, field, value)

    with pytest.raises(RuntimeError, match=message):
        config.validate()


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("debug", True, "DEBUG"),
        ("auth_required", False, "AUTH_REQUIRED"),
        ("cloudflare_access_required", False, "CLOUDFLARE_ACCESS_REQUIRED"),
        ("rate_limit_enabled", False, "RATE_LIMIT_ENABLED"),
        ("strict_readiness", False, "STRICT_READINESS"),
        ("cors_origins", [], "CORS_ORIGINS"),
        ("encryption_key", None, "E2E_SECRET_KEY"),
        ("encryption_key", "not-base64", "E2E_SECRET_KEY"),
        ("anthropic_api_key", None, "ANTHROPIC_API_KEY"),
    ],
)
def test_production_config_fails_closed(
    field: str,
    value: object,
    message: str,
) -> None:
    config = _production_config(**{field: value})

    with pytest.raises(RuntimeError, match=message):
        config.validate()


def test_canonical_production_config_is_valid() -> None:
    _production_config().validate()
