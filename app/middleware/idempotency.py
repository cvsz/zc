"""Durable idempotency enforcement for authenticated mutating HTTP requests."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import re
import tempfile
import time
from pathlib import Path
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.auth import verify_token
from app.core.config import Config

__all__ = ["IdempotencyMiddleware"]

_UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
_IDEMPOTENCY_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")
_VOLATILE_HEADERS = {b"x-request-id", b"x-process-time", b"idempotency-replayed"}


class IdempotencyMiddleware:
    """Persist and replay one response for each identity, route, and request key."""

    def __init__(self, app: ASGIApp, config: Config) -> None:
        self.app = app
        self.config = config
        self.directory = config.idempotency_dir
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.directory.is_symlink() or not self.directory.is_dir():
            raise RuntimeError("IDEMPOTENCY_DIR must be a regular directory")
        os.chmod(self.directory, 0o700)
        self._locks = [asyncio.Lock() for _ in range(256)]

    async def __call__(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        if (
            scope["type"] != "http"
            or scope.get("method", "").upper() not in _UNSAFE_METHODS
        ):
            await self.app(scope, receive, send)
            return

        identity = self._identity(scope)
        if identity is None:
            await self._error(
                send,
                401,
                "application_authentication_required",
                "A valid application bearer token is required.",
            )
            return

        key = self._header(scope, b"idempotency-key")
        if key is None or not _IDEMPOTENCY_KEY.fullmatch(key):
            await self._error(
                send,
                400,
                "idempotency_key_required",
                "A valid Idempotency-Key header is required.",
            )
            return

        fingerprint = self._fingerprint(scope, identity, key)
        spool, request_digest = await self._spool_request(receive)
        lock = await self._lock_for(fingerprint)
        try:
            async with lock:
                entry = self._load(fingerprint)
                if entry is not None:
                    if entry["request_digest"] != request_digest:
                        await self._error(
                            send,
                            409,
                            "idempotency_key_conflict",
                            "The Idempotency-Key was already used for another request.",
                        )
                        return
                    if not entry["replayable"]:
                        await self._error(
                            send,
                            409,
                            "idempotency_response_not_replayable",
                            "The original response exceeded the replay limit.",
                        )
                        return
                    await self._replay(send, entry)
                    return

                replay_receive = self._replay_receive(spool)
                await self._execute_and_store(
                    scope,
                    replay_receive,
                    send,
                    fingerprint,
                    request_digest,
                )
        finally:
            spool.close()

    def _identity(self, scope: Scope) -> str | None:
        if not self.config.auth_required:
            return "development:default"
        authorization = self._header(scope, b"authorization")
        if authorization is None or not authorization.startswith("Bearer "):
            return None
        payload = verify_token(authorization[7:])
        if payload is None:
            return None
        subject = str(payload["sub"])
        tenant_id = str(payload["tenant_id"])
        roles = sorted(set(str(role) for role in payload["roles"]))
        authorization_scope = b"\0".join(
            [
                subject.encode(),
                tenant_id.encode(),
                ",".join(roles).encode(),
            ]
        )
        return hashlib.sha256(authorization_scope).hexdigest()

    @staticmethod
    def _header(scope: Scope, wanted: bytes) -> str | None:
        for name, value in scope.get("headers", []):
            if name.lower() == wanted:
                try:
                    return value.decode("ascii")
                except UnicodeDecodeError:
                    return None
        return None

    @staticmethod
    def _fingerprint(scope: Scope, identity: str, key: str) -> str:
        material = b"\0".join(
            (
                identity.encode(),
                str(scope.get("method", "")).encode(),
                bytes(scope.get("raw_path", b"")),
                bytes(scope.get("query_string", b"")),
                key.encode(),
            )
        )
        return hashlib.sha256(material).hexdigest()

    async def _spool_request(self, receive: Receive) -> tuple[Any, str]:
        spool = tempfile.SpooledTemporaryFile(max_size=1024 * 1024, mode="w+b")
        digest = hashlib.sha256()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                spool.close()
                raise ConnectionError("client disconnected")
            if message["type"] != "http.request":
                continue
            body = message.get("body", b"")
            spool.write(body)
            digest.update(body)
            if not message.get("more_body", False):
                break
        spool.seek(0)
        return spool, digest.hexdigest()

    @staticmethod
    def _replay_receive(spool: Any) -> Receive:
        completed = False

        async def receive() -> Message:
            nonlocal completed
            if completed:
                return {"type": "http.request", "body": b"", "more_body": False}
            body = spool.read(64 * 1024)
            more_body = bool(body) and spool.read(1) != b""
            if more_body:
                spool.seek(-1, os.SEEK_CUR)
            else:
                completed = True
            return {
                "type": "http.request",
                "body": body,
                "more_body": more_body,
            }

        return receive

    async def _execute_and_store(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
        fingerprint: str,
        request_digest: str,
    ) -> None:
        status = 500
        headers: list[tuple[bytes, bytes]] = []
        response_body = bytearray()
        replayable = True
        completed = False

        async def capture(message: Message) -> None:
            nonlocal status, headers, replayable, completed
            if message["type"] == "http.response.start":
                status = int(message["status"])
                headers = [
                    (name, value)
                    for name, value in message.get("headers", [])
                    if name.lower() not in _VOLATILE_HEADERS
                ]
                message["headers"] = list(message.get("headers", [])) + [
                    (b"idempotency-replayed", b"false")
                ]
            elif message["type"] == "http.response.body":
                body = message.get("body", b"")
                if (
                    len(response_body) + len(body)
                    <= self.config.idempotency_max_response_bytes
                ):
                    response_body.extend(body)
                else:
                    replayable = False
                completed = not message.get("more_body", False)
            await send(message)

        await self.app(scope, receive, capture)
        if completed:
            self._store(
                fingerprint,
                {
                    "request_digest": request_digest,
                    "status": status,
                    "headers": [
                        [
                            base64.b64encode(name).decode("ascii"),
                            base64.b64encode(value).decode("ascii"),
                        ]
                        for name, value in headers
                    ],
                    "body": (
                        base64.b64encode(response_body).decode("ascii")
                        if replayable
                        else ""
                    ),
                    "replayable": replayable,
                    "expires_at": time.time() + self.config.idempotency_ttl_seconds,
                },
            )

    async def _replay(self, send: Send, entry: dict[str, Any]) -> None:
        headers = [
            (base64.b64decode(name), base64.b64decode(value))
            for name, value in entry["headers"]
        ]
        headers.append((b"idempotency-replayed", b"true"))
        await send(
            {
                "type": "http.response.start",
                "status": int(entry["status"]),
                "headers": headers,
            }
        )
        await send(
            {
                "type": "http.response.body",
                "body": base64.b64decode(entry["body"]),
            }
        )

    async def _lock_for(self, fingerprint: str) -> asyncio.Lock:
        return self._locks[int(fingerprint[:2], 16)]

    def _path(self, fingerprint: str) -> Path:
        return self.directory / f"{fingerprint}.json"

    def _load(self, fingerprint: str) -> dict[str, Any] | None:
        path = self._path(fingerprint)
        if path.is_symlink():
            raise RuntimeError("Unsafe idempotency cache entry")
        try:
            entry = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except (OSError, ValueError, TypeError):
            path.unlink(missing_ok=True)
            return None
        if float(entry.get("expires_at", 0)) <= time.time():
            path.unlink(missing_ok=True)
            return None
        return entry

    def _store(self, fingerprint: str, entry: dict[str, Any]) -> None:
        path = self._path(fingerprint)
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{fingerprint}.",
            suffix=".part",
            dir=self.directory,
        )
        temporary = Path(temporary_name)
        try:
            os.fchmod(descriptor, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                json.dump(entry, stream, separators=(",", ":"))
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
            self._prune()
        finally:
            temporary.unlink(missing_ok=True)

    def _prune(self) -> None:
        """Bound durable replay state and preferentially remove expired entries."""
        paths = sorted(
            self.directory.glob("*.json"),
            key=lambda candidate: candidate.stat().st_mtime,
        )
        excess = len(paths) - self.config.idempotency_max_entries
        if excess <= 0:
            return
        now = time.time()
        expired: list[Path] = []
        retained: list[Path] = []
        for path in paths:
            try:
                entry = json.loads(path.read_text(encoding="utf-8"))
                if float(entry.get("expires_at", 0)) <= now:
                    expired.append(path)
                else:
                    retained.append(path)
            except (OSError, ValueError, TypeError):
                expired.append(path)
        for path in (expired + retained)[:excess]:
            path.unlink(missing_ok=True)

    @staticmethod
    async def _error(
        send: Send,
        status: int,
        code: str,
        message: str,
    ) -> None:
        body = json.dumps(
            {"error": {"code": code, "message": message}},
            separators=(",", ":"),
        ).encode()
        headers = [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode()),
            (b"cache-control", b"no-store"),
        ]
        if status == 401:
            headers.append((b"www-authenticate", b"Bearer"))
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": headers,
            }
        )
        await send({"type": "http.response.body", "body": body})
