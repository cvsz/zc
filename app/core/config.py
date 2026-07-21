"""Centralized runtime configuration for the zcoder API service."""

import base64
import binascii
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

APP_NAME = "zcoder"
APP_VERSION = "1.33.0"
DEFAULT_API_PORT = 8000


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Config:
    """Application configuration loaded from environment variables."""

    app_name: str = APP_NAME
    version: str = APP_VERSION
    debug: bool = False
    environment: str = "production"

    api_host: str = "127.0.0.1"
    api_port: int = DEFAULT_API_PORT
    api_workers: int = 1
    api_timeout: int = 30
    strict_readiness: bool = False

    ai_provider: str = "litellm"
    litellm_config_path: Path = field(
        default_factory=lambda: Path("./litellm-config.yaml")
    )
    litellm_model: str = "zc-default"
    litellm_timeout_seconds: int = 120
    anthropic_api_key: Optional[str] = None

    protobuf_enabled: bool = True
    max_message_size: int = 90 * 1024 * 1024

    redis_url: str = "redis://localhost:6379"
    redis_pool_size: int = 10
    redis_ttl_default: int = 3600
    redis_enabled: bool = False

    http_pool_size: int = 20

    upload_chunk_size: int = 4 * 1024 * 1024
    upload_max_size: int = 50 * 1024 * 1024 * 1024
    upload_retention_seconds: int = 86400
    upload_min_free_bytes: int = 1024 * 1024 * 1024
    upload_temp_dir: Path = field(default_factory=lambda: Path("./data/uploads"))
    idempotency_dir: Path = field(default_factory=lambda: Path("./data/idempotency"))
    idempotency_ttl_seconds: int = 86400
    idempotency_max_response_bytes: int = 1024 * 1024
    idempotency_max_entries: int = 1000
    chat_session_dir: Path = field(default_factory=lambda: Path("./data/chat/sessions"))
    storage_backend: str = "local"

    jwt_secret: Optional[str] = None
    jwt_algorithm: str = "HS256"
    jwt_issuer: str = "zc"
    jwt_audience: str = "zc-api"
    jwt_expiry_seconds: int = 3600
    auth_required: bool = True
    cloudflare_access_required: bool = False
    cloudflare_access_team_domain: Optional[str] = None
    cloudflare_access_aud: Optional[str] = None
    cloudflare_access_jwks_cache_seconds: int = 300
    encryption_key: Optional[str] = None
    cors_origins: list[str] = field(default_factory=list)

    rate_limit_enabled: bool = False
    rate_limit_requests: int = 1000
    rate_limit_window: int = 60

    control_panel_enabled: bool = True
    frontend_enabled: bool = True

    @classmethod
    def from_env(cls) -> "Config":
        """Load configuration from environment variables."""
        return cls(
            app_name=APP_NAME,
            version=APP_VERSION,
            debug=_env_bool("DEBUG", False),
            environment=os.getenv("ENVIRONMENT", "production").strip().lower(),
            api_host=os.getenv("API_HOST", "127.0.0.1"),
            api_port=int(os.getenv("API_PORT", str(DEFAULT_API_PORT))),
            api_workers=int(os.getenv("API_WORKERS", "1")),
            api_timeout=int(os.getenv("API_TIMEOUT", "30")),
            strict_readiness=_env_bool("STRICT_READINESS", False),
            ai_provider=os.getenv("AI_PROVIDER", "litellm").strip().lower(),
            litellm_config_path=Path(
                os.getenv("LITELLM_CONFIG_PATH", "./litellm-config.yaml")
            ),
            litellm_model=os.getenv("LITELLM_MODEL", "zc-default"),
            litellm_timeout_seconds=int(os.getenv("LITELLM_TIMEOUT_SECONDS", "120")),
            anthropic_api_key=os.getenv("ANTHROPIC_API_KEY"),
            protobuf_enabled=_env_bool("PROTOBUF_ENABLED", True),
            max_message_size=int(os.getenv("MAX_MESSAGE_SIZE", "94371840")),
            redis_url=os.getenv("REDIS_URL", "redis://localhost:6379"),
            redis_pool_size=int(os.getenv("REDIS_POOL_SIZE", "10")),
            redis_ttl_default=int(os.getenv("REDIS_TTL_DEFAULT", "3600")),
            redis_enabled=_env_bool("REDIS_ENABLED", False),
            http_pool_size=int(os.getenv("HTTP_POOL_SIZE", "20")),
            upload_chunk_size=int(os.getenv("UPLOAD_CHUNK_SIZE", "4194304")),
            upload_max_size=int(os.getenv("UPLOAD_MAX_SIZE", "53687091200")),
            upload_retention_seconds=int(
                os.getenv("UPLOAD_RETENTION_SECONDS", "86400")
            ),
            upload_min_free_bytes=int(os.getenv("UPLOAD_MIN_FREE_BYTES", "1073741824")),
            upload_temp_dir=Path(os.getenv("UPLOAD_TEMP_DIR", "./data/uploads")),
            idempotency_dir=Path(os.getenv("IDEMPOTENCY_DIR", "./data/idempotency")),
            idempotency_ttl_seconds=int(os.getenv("IDEMPOTENCY_TTL_SECONDS", "86400")),
            idempotency_max_response_bytes=int(
                os.getenv("IDEMPOTENCY_MAX_RESPONSE_BYTES", "1048576")
            ),
            idempotency_max_entries=int(os.getenv("IDEMPOTENCY_MAX_ENTRIES", "1000")),
            chat_session_dir=Path(
                os.getenv("CHAT_SESSION_DIR", "./data/chat/sessions")
            ),
            storage_backend=os.getenv("STORAGE_BACKEND", "local"),
            jwt_secret=os.getenv("JWT_SECRET"),
            jwt_algorithm=os.getenv("JWT_ALGORITHM", "HS256"),
            jwt_issuer=os.getenv("JWT_ISSUER", "zc"),
            jwt_audience=os.getenv("JWT_AUDIENCE", "zc-api"),
            jwt_expiry_seconds=int(os.getenv("JWT_EXPIRY_SECONDS", "3600")),
            auth_required=_env_bool("AUTH_REQUIRED", True),
            cloudflare_access_required=_env_bool("CLOUDFLARE_ACCESS_REQUIRED", False),
            cloudflare_access_team_domain=os.getenv("CLOUDFLARE_ACCESS_TEAM_DOMAIN"),
            cloudflare_access_aud=os.getenv("CLOUDFLARE_ACCESS_AUD"),
            cloudflare_access_jwks_cache_seconds=int(
                os.getenv("CLOUDFLARE_ACCESS_JWKS_CACHE_SECONDS", "300")
            ),
            encryption_key=os.getenv("E2E_SECRET_KEY"),
            cors_origins=[
                origin.strip()
                for origin in os.getenv("CORS_ORIGINS", "").split(",")
                if origin.strip()
            ],
            rate_limit_enabled=_env_bool("RATE_LIMIT_ENABLED", False),
            rate_limit_requests=int(os.getenv("RATE_LIMIT_REQUESTS", "1000")),
            rate_limit_window=int(os.getenv("RATE_LIMIT_WINDOW", "60")),
            control_panel_enabled=_env_bool("CONTROL_PANEL_ENABLED", True),
            frontend_enabled=_env_bool("FRONTEND_ENABLED", True),
        )

    def ensure_dirs(self) -> None:
        for name, directory in (
            ("UPLOAD_TEMP_DIR", self.upload_temp_dir),
            ("IDEMPOTENCY_DIR", self.idempotency_dir),
            ("CHAT_SESSION_DIR", self.chat_session_dir),
        ):
            if directory.is_symlink():
                raise RuntimeError(f"{name} must not be a symlink")
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            if not directory.is_dir():
                raise RuntimeError(f"{name} must be a directory")
            os.chmod(directory, 0o700)

    def validate(self) -> None:
        """Fail closed when production security invariants are not configured."""
        if self.environment not in {"development", "test", "production"}:
            raise RuntimeError(
                "ENVIRONMENT must be 'development', 'test', or 'production'"
            )
        if (
            self.environment == "production"
            and self.auth_required
            and not self.jwt_secret
        ):
            raise RuntimeError(
                "JWT_SECRET is required when production authentication is enabled"
            )
        if (
            self.environment == "production"
            and self.auth_required
            and self.jwt_secret
            and len(self.jwt_secret) < 32
        ):
            raise RuntimeError("JWT_SECRET must contain at least 32 characters")
        if self.jwt_algorithm != "HS256":
            raise RuntimeError("JWT_ALGORITHM must be HS256")
        if not self.jwt_issuer or not self.jwt_audience:
            raise RuntimeError("JWT_ISSUER and JWT_AUDIENCE must not be empty")
        if self.jwt_expiry_seconds < 60 or self.jwt_expiry_seconds > 86400:
            raise RuntimeError("JWT_EXPIRY_SECONDS must be between 60 and 86400")
        if self.api_port < 1 or self.api_port > 65535:
            raise RuntimeError("API_PORT must be between 1 and 65535")
        if self.api_workers < 1:
            raise RuntimeError("API_WORKERS must be positive")
        if self.api_timeout <= 0:
            raise RuntimeError("API_TIMEOUT must be positive")
        if self.protobuf_enabled and self.api_host != "127.0.0.1":
            raise RuntimeError("gRPC requires API_HOST to be 127.0.0.1")
        if self.protobuf_enabled and self.api_port >= 65535:
            raise RuntimeError("API_PORT must leave the next port available for gRPC")
        if self.environment == "production":
            if self.api_host != "127.0.0.1":
                raise RuntimeError("API_HOST must be 127.0.0.1 in production")
            if self.api_workers != 1:
                raise RuntimeError("API_WORKERS must be 1 in production")
            if self.debug:
                raise RuntimeError("DEBUG must be disabled in production")
            if not self.auth_required:
                raise RuntimeError("AUTH_REQUIRED must be enabled in production")
            if self.max_message_size > 90 * 1024 * 1024:
                raise RuntimeError(
                    "MAX_MESSAGE_SIZE must not exceed 90 MiB in production"
                )
            if self.cors_origins and any(
                origin == "*" or not origin.startswith("https://") or "*" in origin
                for origin in self.cors_origins
            ):
                raise RuntimeError(
                    "Production CORS_ORIGINS must contain exact HTTPS origins"
                )
            if not self.cloudflare_access_required:
                raise RuntimeError(
                    "CLOUDFLARE_ACCESS_REQUIRED must be enabled in production"
                )
        if self.cloudflare_access_required:
            if not self.auth_required:
                raise RuntimeError(
                    "AUTH_REQUIRED must be enabled when Cloudflare Access is required"
                )
            if not self.cloudflare_access_team_domain:
                raise RuntimeError(
                    "CLOUDFLARE_ACCESS_TEAM_DOMAIN is required when Cloudflare Access is enabled"
                )
            if not self.cloudflare_access_aud:
                raise RuntimeError(
                    "CLOUDFLARE_ACCESS_AUD is required when Cloudflare Access is enabled"
                )
            if self.cloudflare_access_jwks_cache_seconds <= 0:
                raise RuntimeError(
                    "CLOUDFLARE_ACCESS_JWKS_CACHE_SECONDS must be positive"
                )
            from .cloudflare_access import CloudflareAccessVerifier

            CloudflareAccessVerifier(
                team_domain=self.cloudflare_access_team_domain,
                audience=self.cloudflare_access_aud,
                cache_seconds=self.cloudflare_access_jwks_cache_seconds,
            )
        if self.environment == "production":
            if not self.rate_limit_enabled:
                raise RuntimeError("RATE_LIMIT_ENABLED must be enabled in production")
            if not self.strict_readiness:
                raise RuntimeError("STRICT_READINESS must be enabled in production")
            if self.cors_origins != ["https://zeaz.dev"]:
                raise RuntimeError(
                    "Production CORS_ORIGINS must be exactly https://zeaz.dev"
                )
            if not self.encryption_key:
                raise RuntimeError("E2E_SECRET_KEY is required in production")
            try:
                encryption_key = base64.b64decode(
                    self.encryption_key,
                    validate=True,
                )
            except (binascii.Error, ValueError) as exc:
                raise RuntimeError("E2E_SECRET_KEY must be valid base64") from exc
            if len(encryption_key) != 32:
                raise RuntimeError("E2E_SECRET_KEY must encode exactly 32 bytes")
        if self.ai_provider not in {"anthropic", "litellm"}:
            raise RuntimeError("AI_PROVIDER must be 'anthropic' or 'litellm'")
        if self.environment == "production" and self.ai_provider != "litellm":
            raise RuntimeError("AI_PROVIDER must be 'litellm' in production")
        if self.litellm_timeout_seconds <= 0:
            raise RuntimeError("LITELLM_TIMEOUT_SECONDS must be positive")
        if self.ai_provider == "litellm":
            if not self.litellm_model:
                raise RuntimeError("LITELLM_MODEL must not be empty")
            if not self.litellm_config_path.is_file():
                raise RuntimeError(
                    f"LiteLLM config not found: {self.litellm_config_path}"
                )
        if self.environment == "production" and not self.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is required in production")
        if (
            self.upload_chunk_size <= 0
            or self.upload_chunk_size > self.max_message_size
        ):
            raise RuntimeError("UPLOAD_CHUNK_SIZE must be within MAX_MESSAGE_SIZE")
        if self.upload_max_size < self.upload_chunk_size:
            raise RuntimeError("UPLOAD_MAX_SIZE must be at least UPLOAD_CHUNK_SIZE")
        if self.upload_retention_seconds < 3600:
            raise RuntimeError("UPLOAD_RETENTION_SECONDS must be at least 3600")
        if self.upload_min_free_bytes < 0:
            raise RuntimeError("UPLOAD_MIN_FREE_BYTES must not be negative")
        if self.storage_backend != "local":
            raise RuntimeError("STORAGE_BACKEND must be 'local'")
        if self.idempotency_ttl_seconds <= 0:
            raise RuntimeError("IDEMPOTENCY_TTL_SECONDS must be positive")
        if self.idempotency_max_response_bytes <= 0:
            raise RuntimeError("IDEMPOTENCY_MAX_RESPONSE_BYTES must be positive")
        if self.idempotency_max_entries <= 0:
            raise RuntimeError("IDEMPOTENCY_MAX_ENTRIES must be positive")
        if self.rate_limit_enabled and not self.redis_enabled and self.api_workers != 1:
            raise RuntimeError(
                "API_WORKERS must be 1 when rate limiting uses in-memory state"
            )
        if self.rate_limit_requests <= 0 or self.rate_limit_window <= 0:
            raise RuntimeError(
                "RATE_LIMIT_REQUESTS and RATE_LIMIT_WINDOW must be positive"
            )
        if self.http_pool_size <= 0:
            raise RuntimeError("HTTP_POOL_SIZE must be positive")
        if self.redis_pool_size <= 0 or self.redis_ttl_default <= 0:
            raise RuntimeError("REDIS_POOL_SIZE and REDIS_TTL_DEFAULT must be positive")
        if self.redis_enabled:
            parsed_redis = urlparse(self.redis_url)
            if (
                parsed_redis.scheme not in {"redis", "rediss"}
                or parsed_redis.hostname is None
            ):
                raise RuntimeError("REDIS_URL must be a valid Redis URL")
            if self.environment == "production" and parsed_redis.hostname not in {
                "127.0.0.1",
                "::1",
                "localhost",
            }:
                raise RuntimeError("Production REDIS_URL must use a loopback host")


_config: Optional[Config] = None


def get_config() -> Config:
    global _config
    if _config is None:
        _config = Config.from_env()
        _config.ensure_dirs()
    return _config


def reload_config() -> Config:
    global _config
    _config = Config.from_env()
    _config.ensure_dirs()
    return _config
