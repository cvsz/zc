"""Outbound HTTP boundary regression tests."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest

from app.core.config import Config
from app.core.http_client import EnterpriseHTTPClient, ResponseTooLargeError


class _Content:
    def __init__(self, chunks: list[bytes]) -> None:
        self._chunks = chunks

    async def iter_chunked(self, _size: int) -> AsyncIterator[bytes]:
        for chunk in self._chunks:
            yield chunk


class _Response:
    status = 200
    headers: dict[str, str] = {}

    def __init__(self, chunks: list[bytes], content_length: int | None = None) -> None:
        self.content = _Content(chunks)
        self.content_length = content_length

    async def __aenter__(self) -> "_Response":
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None


class _Session:
    def __init__(self, response: _Response) -> None:
        self.response = response
        self.kwargs: dict[str, Any] = {}

    def request(self, *_args: object, **kwargs: Any) -> _Response:
        self.kwargs = kwargs
        return self.response


@pytest.mark.asyncio
async def test_http_client_disables_redirects_and_bounds_streamed_response() -> None:
    session = _Session(_Response([b"1234", b"5"]))
    client = EnterpriseHTTPClient(Config(environment="test"))
    client._session = session  # type: ignore[assignment]

    with pytest.raises(ResponseTooLargeError, match="configured limit"):
        await client.get(
            "https://example.com/data",
            max_retries=0,
            max_response_bytes=4,
        )

    assert session.kwargs["allow_redirects"] is False


@pytest.mark.asyncio
async def test_http_client_rejects_oversized_content_length_before_reading() -> None:
    session = _Session(_Response([], content_length=5))
    client = EnterpriseHTTPClient(Config(environment="test"))
    client._session = session  # type: ignore[assignment]

    with pytest.raises(ResponseTooLargeError, match="configured limit"):
        await client.get(
            "https://example.com/data",
            max_retries=0,
            max_response_bytes=4,
        )
