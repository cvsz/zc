"""Structured, redacted application logging for the public-local runtime."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

__all__ = ["configure_application_logging"]

_SECRET = re.compile(
    r"(?i)(authorization|cookie|token|api[_-]?key|secret)"
    r"([\"']?\s*[:=]\s*[\"']?)([^,\s\"']+)"
)
_SECRET_FIELD = re.compile(r"(?i)(authorization|cookie|token|api[_-]?key|secret)")
_STANDARD_FIELDS = frozenset(
    {
        "name",
        "msg",
        "args",
        "levelname",
        "levelno",
        "pathname",
        "filename",
        "module",
        "exc_info",
        "exc_text",
        "stack_info",
        "lineno",
        "funcName",
        "created",
        "msecs",
        "relativeCreated",
        "thread",
        "threadName",
        "processName",
        "process",
        "taskName",
    }
)


def _redact(value: str) -> str:
    return _SECRET.sub(r"\1\2[REDACTED]", value)


def _redact_value(value: Any, key: str = "") -> Any:
    """Redact credential-shaped fields recursively before JSON serialization."""
    if _SECRET_FIELD.search(key):
        return "[REDACTED]"
    if isinstance(value, str):
        return _redact(value)
    if isinstance(value, dict):
        return {
            str(nested_key): _redact_value(nested_value, str(nested_key))
            for nested_key, nested_value in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_redact_value(item) for item in value]
    return value


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(
                record.created,
                timezone.utc,
            ).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": _redact(record.getMessage()),
        }
        for key, value in record.__dict__.items():
            if key not in _STANDARD_FIELDS and not key.startswith("_"):
                payload[key] = _redact_value(value, key)
        if record.exc_info:
            payload["exception"] = _redact(self.formatException(record.exc_info))
        return json.dumps(payload, separators=(",", ":"), default=str)


def configure_application_logging(production: bool) -> None:
    """Configure the app namespace once without altering third-party loggers."""
    logger = logging.getLogger("app")
    logger.handlers.clear()
    handler = logging.StreamHandler()
    if production:
        handler.setFormatter(_JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
        )
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False
