"""Regression tests for sanitized, correlation-ID based public errors."""

from __future__ import annotations

import httpx
import pytest

from app import main


@pytest.mark.asyncio
async def test_unexpected_error_is_sanitized_and_correlated() -> None:
    async def fail() -> None:
        raise RuntimeError("secret internal detail")

    main.app.add_api_route("/_test/unexpected", fail, methods=["GET"])
    transport = httpx.ASGITransport(app=main.app, raise_app_exceptions=False)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.get(
            "/_test/unexpected",
            headers={"X-Request-ID": "audit-request-1"},
        )

    assert response.status_code == 500
    assert response.headers["x-request-id"] == "audit-request-1"
    assert response.json() == {
        "error": {
            "code": "internal_error",
            "message": "The request could not be completed.",
            "request_id": "audit-request-1",
        }
    }
    assert "secret internal detail" not in response.text


@pytest.mark.asyncio
async def test_invalid_request_id_is_replaced() -> None:
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.get(
            "/v1/meta",
            headers={"X-Request-ID": "invalid request id"},
        )

    assert response.status_code == 200
    assert response.headers["x-request-id"] != "invalid request id"
    assert len(response.headers["x-request-id"]) == 32
