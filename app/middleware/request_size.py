"""Streaming HTTP request body limits for the public API boundary."""

from __future__ import annotations

from starlette.types import ASGIApp, Message, Receive, Scope, Send

__all__ = ["RequestSizeLimitMiddleware"]


class _RequestTooLarge(Exception):
    """Internal control-flow signal raised before a route consumes excess data."""


class RequestSizeLimitMiddleware:
    """Reject declared or streamed request bodies above a fixed byte budget."""

    def __init__(self, app: ASGIApp, max_body_bytes: int) -> None:
        if max_body_bytes <= 0:
            raise ValueError("max_body_bytes must be positive")
        self.app = app
        self.max_body_bytes = max_body_bytes

    async def __call__(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        content_length = self._content_length(scope)
        if content_length is not None and content_length > self.max_body_bytes:
            await self._send_too_large(send)
            return

        received = 0
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_body_bytes:
                    raise _RequestTooLarge
            return message

        async def tracked_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracked_send)
        except _RequestTooLarge:
            if response_started:
                raise
            await self._send_too_large(send)

    @staticmethod
    def _content_length(scope: Scope) -> int | None:
        for name, value in scope.get("headers", []):
            if name.lower() != b"content-length":
                continue
            try:
                parsed = int(value)
            except ValueError:
                return None
            return parsed if parsed >= 0 else None
        return None

    @staticmethod
    async def _send_too_large(send: Send) -> None:
        body = (
            b'{"error":{"code":"request_too_large",'
            b'"message":"The request body exceeds the configured limit."}}'
        )
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                    (b"cache-control", b"no-store"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
