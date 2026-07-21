"""Regression tests for bounded public HTTP request bodies."""

from __future__ import annotations

import httpx
import pytest
from fastapi import FastAPI, Request

from app.middleware.request_size import RequestSizeLimitMiddleware


def _app(limit: int = 4) -> FastAPI:
    app = FastAPI()

    @app.post("/echo")
    async def echo(request: Request) -> dict[str, int]:
        return {"size": len(await request.body())}

    app.add_middleware(RequestSizeLimitMiddleware, max_body_bytes=limit)
    return app


@pytest.mark.asyncio
async def test_rejects_declared_oversized_body() -> None:
    transport = httpx.ASGITransport(app=_app())
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.post("/echo", content=b"12345")

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "request_too_large"
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.asyncio
async def test_accepts_body_at_exact_limit() -> None:
    transport = httpx.ASGITransport(app=_app())
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.post("/echo", content=b"1234")

    assert response.status_code == 200
    assert response.json() == {"size": 4}


@pytest.mark.asyncio
async def test_rejects_chunked_body_without_content_length() -> None:
    async def chunks():
        yield b"123"
        yield b"45"

    transport = httpx.ASGITransport(app=_app())
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
    ) as client:
        response = await client.post("/echo", content=chunks())

    assert response.status_code == 413
