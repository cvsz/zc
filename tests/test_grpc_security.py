"""Authentication and tenant-isolation tests for the localhost gRPC API."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import grpc
import pytest

import app.core.config as config_module
from app.core.auth import create_application_token
from app.core.config import Config
from app.grpc.wire_servicer import WireServiceServicer, create_grpc_server
from app.services.delta.sync_service import DeltaSyncService
from app.services.upload_manager import UploadSession


class Aborted(grpc.RpcError):
    def __init__(self, code: grpc.StatusCode, details: str) -> None:
        self.code = code
        self.details = details


@dataclass
class Metadata:
    key: str
    value: str


class Context:
    def __init__(self, token: str | None) -> None:
        self.token = token

    def invocation_metadata(self) -> list[Metadata]:
        if self.token is None:
            return []
        return [Metadata("authorization", f"Bearer {self.token}")]

    async def abort(self, code: grpc.StatusCode, details: str) -> None:
        raise Aborted(code, details)

    def cancelled(self) -> bool:
        return False


class UploadSessions:
    def __init__(self) -> None:
        self.session = UploadSession(
            session_id="session-a",
            tenant_id="tenant-a",
            file_id="file-a",
            file_name="file-a.bin",
            total_size=4,
            expected_hash=None,
            chunk_size=4,
            total_chunks=1,
        )

    async def get_session(self, _session_id: str, tenant_id: str) -> Any:
        if tenant_id != "tenant-a":
            raise PermissionError("cross tenant")
        return self.session

    async def upload_chunk(self, **_kwargs: Any) -> bool:
        self.session.uploaded_chunks.add(0)
        return True

    async def get_session_counts(self) -> tuple[int, int]:
        return 1, 0

    async def health_check(self) -> dict[str, Any]:
        return {"ready": True}


class MissingUploadSession(UploadSessions):
    async def get_session(self, _session_id: str, tenant_id: str) -> Any:
        return None


@pytest.fixture
def grpc_config(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Config:
    config = Config(
        environment="test",
        auth_required=True,
        jwt_secret="a-grpc-security-test-secret-over-32-characters",
        upload_temp_dir=tmp_path / "uploads",
    )
    monkeypatch.setattr(config_module, "_config", config)
    return config


def _servicer(tmp_path: Path) -> WireServiceServicer:
    return WireServiceServicer(
        upload_manager=UploadSessions(),  # type: ignore[arg-type]
        delta_service=DeltaSyncService(tmp_path / "delta"),
    )


@pytest.mark.asyncio
async def test_grpc_rejects_missing_bearer(
    tmp_path: Path,
    grpc_config: Config,
) -> None:
    with pytest.raises(Aborted) as error:
        await _servicer(tmp_path)._authorize(Context(None), {"viewer"})  # type: ignore[arg-type]

    assert error.value.code is grpc.StatusCode.UNAUTHENTICATED


@pytest.mark.asyncio
async def test_grpc_rejects_wrong_role(
    tmp_path: Path,
    grpc_config: Config,
) -> None:
    token = create_application_token("user", "tenant-a", ["viewer"])

    with pytest.raises(Aborted) as error:
        await _servicer(tmp_path)._authorize(  # type: ignore[arg-type]
            Context(token),
            {"admin"},
        )

    assert error.value.code is grpc.StatusCode.PERMISSION_DENIED


@pytest.mark.asyncio
async def test_grpc_progress_hides_cross_tenant_session(
    tmp_path: Path,
    grpc_config: Config,
) -> None:
    servicer = _servicer(tmp_path)
    token = create_application_token("user", "tenant-b", ["viewer"])
    stream = servicer.StreamUploadProgress(
        SimpleNamespace(session_id="session-a"),
        Context(token),  # type: ignore[arg-type]
    )

    with pytest.raises(Aborted) as error:
        await anext(stream)

    assert error.value.code is grpc.StatusCode.NOT_FOUND
    assert error.value.details == "Session not found"


@pytest.mark.asyncio
async def test_grpc_chunk_and_progress_use_durable_session_after_restart(
    tmp_path: Path,
    grpc_config: Config,
) -> None:
    servicer = _servicer(tmp_path)
    token = create_application_token("user", "tenant-a", ["developer"])
    context = Context(token)

    response = await servicer.UploadChunk(
        SimpleNamespace(
            session_id="session-a",
            chunk_index=0,
            data=b"data",
            chunk_hash="digest",
        ),
        context,  # type: ignore[arg-type]
    )
    progress = servicer.StreamUploadProgress(
        SimpleNamespace(session_id="session-a"),
        context,  # type: ignore[arg-type]
    )
    update = await anext(progress)

    assert response.success is True
    assert response.progress_percent == 100
    assert update.percent_complete == 100
    assert update.bytes_transferred == 4


@pytest.mark.asyncio
async def test_grpc_chunk_preserves_not_found_abort(
    tmp_path: Path,
    grpc_config: Config,
) -> None:
    servicer = WireServiceServicer(
        upload_manager=MissingUploadSession(),  # type: ignore[arg-type]
        delta_service=DeltaSyncService(tmp_path / "delta"),
    )
    token = create_application_token("user", "tenant-a", ["developer"])

    with pytest.raises(Aborted) as error:
        await servicer.UploadChunk(
            SimpleNamespace(
                session_id="session-a",
                chunk_index=0,
                data=b"data",
                chunk_hash="digest",
            ),
            Context(token),  # type: ignore[arg-type]
        )

    assert error.value.code is grpc.StatusCode.NOT_FOUND


@pytest.mark.asyncio
async def test_grpc_server_binds_local_ephemeral_port(
    tmp_path: Path,
    grpc_config: Config,
) -> None:
    server = await create_grpc_server(
        host="127.0.0.1",
        port=0,
        upload_manager=UploadSessions(),  # type: ignore[arg-type]
        delta_service=DeltaSyncService(tmp_path / "delta"),
        max_message_size=1024,
    )

    await server.start()
    await server.stop(grace=0)


@pytest.mark.asyncio
async def test_grpc_health_uses_real_upload_readiness_without_fake_latency(
    tmp_path: Path,
    grpc_config: Config,
) -> None:
    token = create_application_token("user", "tenant-a", ["viewer"])

    response = await _servicer(tmp_path).HealthCheck(
        SimpleNamespace(),
        Context(token),  # type: ignore[arg-type]
    )

    assert response.status == "healthy"
    assert response.active_connections == 1
    assert response.latency_p50_ms == 0
    assert response.latency_p99_ms == 0
