"""Correlation identifiers for public HTTP requests."""

from __future__ import annotations

import logging
import re
import time
import uuid

from starlette.types import ASGIApp, Message, Receive, Scope, Send

__all__ = ["RequestContextMiddleware"]

_REQUEST_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
logger = logging.getLogger("app.access")


class RequestContextMiddleware:
    """Attach a validated or generated request ID to state and responses."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = self._request_id(scope)
        scope.setdefault("state", {})["request_id"] = request_id
        started_at = time.perf_counter()
        status_code = 500

        async def send_with_request_id(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = int(message["status"])
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", request_id.encode("ascii")))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            state = scope.get("state", {})
            principal = state.get("principal")
            access = state.get("cloudflare_access", {})
            subject = getattr(principal, "subject", None)
            if subject is None and isinstance(access, dict):
                subject = access.get("sub")
            logger.info(
                "request_completed",
                extra={
                    "request_id": request_id,
                    "trace_id": request_id,
                    "subject": subject or "anonymous",
                    "tenant": getattr(principal, "tenant_id", None),
                    "action": scope.get("method", ""),
                    "resource": scope.get("path", ""),
                    "outcome": (
                        "success"
                        if status_code < 400
                        else "denied"
                        if status_code in {401, 403}
                        else "error"
                    ),
                    "status_code": status_code,
                    "duration_ms": round(
                        (time.perf_counter() - started_at) * 1000,
                        2,
                    ),
                },
            )

    @staticmethod
    def _request_id(scope: Scope) -> str:
        for name, value in scope.get("headers", []):
            if name.lower() != b"x-request-id":
                continue
            try:
                candidate = value.decode("ascii")
            except UnicodeDecodeError:
                break
            if _REQUEST_ID.fullmatch(candidate):
                return candidate
            break
        return uuid.uuid4().hex
