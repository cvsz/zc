"""Thin HTTP client used while migrating the legacy CLI to the enterprise API."""

from __future__ import annotations

import json
import mimetypes
import os
from pathlib import Path
import urllib.error
import urllib.request
from dataclasses import dataclass

from wire.resilience import urlopen_http


class EnterpriseAPIError(RuntimeError):
    """The enterprise API rejected or failed a CLI request."""


@dataclass(frozen=True)
class EnterpriseAPIClient:
    """Minimal dependency-free client for the canonical AI response endpoint."""

    base_url: str
    token: str
    timeout_seconds: float = 130.0

    @classmethod
    def from_env(cls) -> "EnterpriseAPIClient | None":
        """Build a client only when API mode is explicitly configured."""
        base_url = os.getenv("ZC_API_URL", "").strip()
        if not base_url:
            return None
        token = os.getenv("ZC_API_TOKEN", "").strip()
        if not token:
            raise EnterpriseAPIError(
                "ZC_API_TOKEN is required when ZC_API_URL is configured"
            )
        return cls(base_url.rstrip("/"), token)

    def create_response(self, payload: dict[str, object]) -> str:
        """Create an AI response without exposing provider credentials."""
        body = self.request("POST", "/v1/ai/responses", payload)
        try:
            return str(body["data"]["output_text"])
        except (KeyError, TypeError) as exc:
            raise EnterpriseAPIError("Enterprise API returned an invalid response") from exc

    def request(
        self,
        method: str,
        path: str,
        payload: dict[str, object] | None = None,
    ) -> dict:
        """Send a JSON request to an explicit resource path."""
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=(
                json.dumps(payload).encode("utf-8")
                if payload is not None
                else None
            ),
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method=method,
        )
        return self._send(request)

    def upload_file(self, path: str) -> dict:
        """Upload a local file to the tenant-scoped file resource."""
        file_path = Path(path)
        data = file_path.read_bytes()
        if any(character in file_path.name for character in '"\r\n'):
            raise EnterpriseAPIError("Filename contains unsafe characters")
        boundary = f"zc-{os.urandom(12).hex()}"
        content_type = (
            mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        )
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="upload"; filename="{file_path.name}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode("utf-8") + data + f"\r\n--{boundary}--\r\n".encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}/v1/files",
            data=body,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Accept": "application/json",
            },
            method="POST",
        )
        return self._send(request)

    def download_file(self, file_id: str, output_path: str) -> str:
        """Download tenant-owned content to an explicit local path."""
        request = urllib.request.Request(
            f"{self.base_url}/v1/files/{file_id}/content",
            headers={"Authorization": f"Bearer {self.token}"},
            method="GET",
        )
        try:
            with urlopen_http(request, timeout=self.timeout_seconds) as response:
                data = response.read()
            Path(output_path).write_bytes(data)
            return output_path
        except urllib.error.HTTPError as exc:
            self._raise_http_error(exc)
        except (OSError, TimeoutError) as exc:
            raise EnterpriseAPIError(f"Enterprise API request failed: {exc}") from exc
        raise EnterpriseAPIError("Enterprise API download failed")

    def _send(self, request: urllib.request.Request) -> dict:
        try:
            with urlopen_http(request, timeout=self.timeout_seconds) as response:
                raw = response.read()
                if not raw:
                    return {}
                body = json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as exc:
            self._raise_http_error(exc)
        except (OSError, TimeoutError, json.JSONDecodeError) as exc:
            raise EnterpriseAPIError(f"Enterprise API request failed: {exc}") from exc
        if not isinstance(body, dict):
            raise EnterpriseAPIError("Enterprise API returned an invalid response")
        return body

    @staticmethod
    def _raise_http_error(exc: urllib.error.HTTPError) -> None:
        try:
            detail = json.loads(exc.read().decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            detail = {}
        error = detail.get("error", {}) if isinstance(detail, dict) else {}
        message = error.get("message") if isinstance(error, dict) else None
        if not message and isinstance(detail, dict):
            message = detail.get("detail")
        raise EnterpriseAPIError(
            str(message) if message else f"Enterprise API returned HTTP {exc.code}"
        ) from exc


__all__ = ["EnterpriseAPIClient", "EnterpriseAPIError"]
