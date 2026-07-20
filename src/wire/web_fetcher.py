"""Bounded public-web fetching for research workflows."""

from __future__ import annotations

import ipaddress
import socket
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from typing import Any


class UnsafeWebFetchError(ValueError):
    """Raised when a URL could reach a non-public or unsupported endpoint."""


class WebFetchLimitError(ValueError):
    """Raised when a response exceeds a configured safety limit."""


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(
        self,
        req: urllib.request.Request,
        fp: Any,
        code: int,
        msg: str,
        headers: Any,
        newurl: str,
    ) -> None:
        return None


Resolver = Callable[..., list[tuple[Any, ...]]]


class SafeWebFetcher:
    """Fetch small textual resources while rejecting SSRF targets."""

    _REDIRECT_CODES = frozenset({301, 302, 303, 307, 308})
    _ALLOWED_PORTS = frozenset({80, 443})
    _TEXT_CONTENT_TYPES = (
        "text/",
        "application/json",
        "application/xml",
        "application/xhtml",
    )

    def __init__(
        self,
        *,
        max_bytes: int = 500_000,
        max_text_chars: int = 4_000,
        max_redirects: int = 5,
        timeout: float = 15.0,
        resolver: Resolver = socket.getaddrinfo,
        opener: Any | None = None,
    ) -> None:
        if min(max_bytes, max_text_chars, max_redirects + 1) <= 0:
            raise ValueError("fetch limits must be positive")
        if timeout <= 0:
            raise ValueError("timeout must be positive")
        self.max_bytes = max_bytes
        self.max_text_chars = max_text_chars
        self.max_redirects = max_redirects
        self.timeout = timeout
        self._resolver = resolver
        self._opener = opener or urllib.request.build_opener(_NoRedirectHandler())

    def fetch(self, target_url: str) -> str:
        """Return bounded text after validating every redirect target."""
        payload, charset = self._fetch_payload(
            target_url,
            allowed_content_types=self._TEXT_CONTENT_TYPES,
        )
        try:
            text = payload.decode(charset, errors="replace")
        except LookupError:
            text = payload.decode("utf-8", errors="replace")
        return text[: self.max_text_chars]

    def fetch_bytes(
        self,
        target_url: str,
        *,
        allowed_content_types: tuple[str, ...],
    ) -> bytes:
        """Return bounded bytes for an explicit content-type allowlist."""
        payload, _charset = self._fetch_payload(
            target_url,
            allowed_content_types=allowed_content_types,
        )
        return payload

    def _fetch_payload(
        self,
        target_url: str,
        *,
        allowed_content_types: tuple[str, ...],
    ) -> tuple[bytes, str]:
        current_url = self._validate_url(target_url)

        for redirect_count in range(self.max_redirects + 1):
            request = urllib.request.Request(
                current_url,
                headers={"User-Agent": "zc-research/1.0"},
            )
            try:
                response = self._opener.open(request, timeout=self.timeout)
            except urllib.error.HTTPError as exc:
                if exc.code not in self._REDIRECT_CODES:
                    raise
                location = exc.headers.get("Location")
                exc.close()
                if not location:
                    raise UnsafeWebFetchError("redirect response is missing Location")
                if redirect_count >= self.max_redirects:
                    raise WebFetchLimitError("too many redirects")
                current_url = self._validate_url(
                    urllib.parse.urljoin(current_url, location)
                )
                continue

            with response:
                final_url = response.geturl()
                if final_url != current_url:
                    self._validate_url(final_url)
                content_type = response.headers.get_content_type().lower()
                if content_type and not any(
                    content_type.startswith(allowed)
                    for allowed in allowed_content_types
                ):
                    raise UnsafeWebFetchError(
                        f"unsupported response content type: {content_type}"
                    )
                payload = response.read(self.max_bytes + 1)
                if len(payload) > self.max_bytes:
                    raise WebFetchLimitError(
                        f"response exceeds {self.max_bytes} bytes"
                    )
                charset = response.headers.get_content_charset() or "utf-8"
                return payload, charset

        raise WebFetchLimitError("too many redirects")

    def _validate_url(self, target_url: str) -> str:
        try:
            parsed = urllib.parse.urlsplit(target_url)
            port = parsed.port
        except (TypeError, ValueError) as exc:
            raise UnsafeWebFetchError("invalid URL") from exc

        if parsed.scheme not in {"http", "https"}:
            raise UnsafeWebFetchError("only HTTP and HTTPS URLs are allowed")
        if not parsed.hostname:
            raise UnsafeWebFetchError("URL must include a hostname")
        if parsed.username is not None or parsed.password is not None:
            raise UnsafeWebFetchError("URL user information is not allowed")
        if port is not None and port not in self._ALLOWED_PORTS:
            raise UnsafeWebFetchError("URL port is not allowed")

        try:
            addresses = self._resolver(
                parsed.hostname,
                port or (443 if parsed.scheme == "https" else 80),
                type=socket.SOCK_STREAM,
            )
        except OSError as exc:
            raise UnsafeWebFetchError("hostname could not be resolved") from exc
        if not addresses:
            raise UnsafeWebFetchError("hostname resolved to no addresses")

        for address_info in addresses:
            raw_address = str(address_info[4][0]).split("%", maxsplit=1)[0]
            try:
                address = ipaddress.ip_address(raw_address)
            except ValueError as exc:
                raise UnsafeWebFetchError("hostname resolved to an invalid address") from exc
            if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
                address = address.ipv4_mapped
            if not address.is_global:
                raise UnsafeWebFetchError(
                    "hostname resolves to a non-public network address"
                )

        return urllib.parse.urlunsplit(parsed)


__all__ = [
    "SafeWebFetcher",
    "UnsafeWebFetchError",
    "WebFetchLimitError",
]
