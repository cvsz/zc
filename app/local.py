"""Dependency-free single-machine development launcher."""

from __future__ import annotations

import os
from pathlib import Path

LOCAL_DEFAULTS = {
    "ENVIRONMENT": "development",
    "DEBUG": "true",
    "AUTH_REQUIRED": "false",
    "STORAGE_BACKEND": "local",
    "UPLOAD_TEMP_DIR": "./data/uploads",
    "IDEMPOTENCY_DIR": "./data/idempotency",
    "CHAT_SESSION_DIR": "./data/chat/sessions",
    "REDIS_ENABLED": "false",
    "RATE_LIMIT_ENABLED": "false",
    "CONTROL_PANEL_ENABLED": "true",
    "FRONTEND_ENABLED": "true",
    "PROTOBUF_ENABLED": "false",
    "STRICT_READINESS": "false",
    "API_HOST": "127.0.0.1",
    "API_PORT": "8000",
    "API_WORKERS": "1",
    "CORS_ORIGINS": "http://127.0.0.1:3000,http://localhost:3000",
}


def apply_local_defaults() -> None:
    """Apply local defaults without overriding explicit user configuration."""
    for name, value in LOCAL_DEFAULTS.items():
        os.environ.setdefault(name, value)
    Path(os.environ["UPLOAD_TEMP_DIR"]).expanduser().resolve().mkdir(
        parents=True, exist_ok=True
    )


def main() -> None:
    """Start the dependency-free local HTTP service."""
    apply_local_defaults()
    from .main import run_server

    run_server(workers=1)


__all__ = ["LOCAL_DEFAULTS", "apply_local_defaults", "main"]


if __name__ == "__main__":
    main()
