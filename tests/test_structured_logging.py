"""Structured production logging regression tests."""

from __future__ import annotations

import json
import logging

import pytest

from app.core.logging import configure_application_logging


def test_production_logs_are_json_and_redact_credentials(
    capsys: pytest.CaptureFixture[str],
) -> None:
    configure_application_logging(production=True)
    logger = logging.getLogger("app.test")

    logger.info(
        "request authorization=Bearer-sensitive-value",
        extra={
            "request_id": "request-1",
            "tenant": "tenant-a",
            "outcome": "success",
            "authorization": "Bearer extra-sensitive-value",
            "context": {
                "api_key": "nested-sensitive-value",
                "safe": "authorization=another-sensitive-value",
            },
        },
    )

    payload = json.loads(capsys.readouterr().err)
    assert payload["message"] == "request authorization=[REDACTED]"
    assert payload["request_id"] == "request-1"
    assert payload["tenant"] == "tenant-a"
    assert payload["outcome"] == "success"
    assert payload["authorization"] == "[REDACTED]"
    assert payload["context"]["api_key"] == "[REDACTED]"
    assert payload["context"]["safe"] == "authorization=[REDACTED]"
    assert "sensitive-value" not in json.dumps(payload)
