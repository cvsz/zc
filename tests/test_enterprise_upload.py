"""Security and durability regression tests for the enterprise upload path."""

from __future__ import annotations

import stat
import time
from pathlib import Path
from types import SimpleNamespace
from typing import IO, Any

import blake3
import pytest

import app.services.upload_manager as upload_manager_module
from app.core.config import Config
from app.services.upload_manager import UploadManager, UploadSession


class LocalAsyncFile:
    """Small aiofiles-compatible adapter for executor-constrained test runners."""

    def __init__(self, path: Path, mode: str) -> None:
        self._path = path
        self._mode = mode
        self._file: IO[Any] | None = None

    async def __aenter__(self) -> LocalAsyncFile:
        self._file = self._path.open(self._mode)
        return self

    async def __aexit__(self, *_args: object) -> None:
        assert self._file is not None
        self._file.close()

    async def read(self, size: int = -1) -> Any:
        assert self._file is not None
        return self._file.read(size)

    async def write(self, data: Any) -> int:
        assert self._file is not None
        return self._file.write(data)

    async def flush(self) -> None:
        assert self._file is not None
        self._file.flush()

    def fileno(self) -> int:
        assert self._file is not None
        return self._file.fileno()


@pytest.fixture(autouse=True)
def local_async_files(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep upload tests deterministic when the host executor is unavailable."""

    monkeypatch.setattr(
        upload_manager_module.aiofiles,
        "open",
        lambda path, mode="r": LocalAsyncFile(Path(path), mode),
    )


class MemoryCache:
    """Minimal cache double matching the upload manager contract."""

    def __init__(self) -> None:
        self.values: dict[str, object] = {}
        self._connected = True

    async def get(self, key: str, default=None):
        return self.values.get(key, default)

    async def set(self, key: str, value, **_kwargs) -> bool:
        self.values[key] = value
        return True

    async def delete(self, key: str) -> bool:
        return self.values.pop(key, None) is not None


def manager(tmp_path: Path) -> UploadManager:
    config = Config(
        environment="test",
        redis_enabled=False,
        protobuf_enabled=False,
        upload_temp_dir=tmp_path,
        upload_chunk_size=4,
        upload_max_size=32,
        upload_min_free_bytes=0,
        storage_backend="local",
    )
    instance = UploadManager(config)
    instance.cache = MemoryCache()
    return instance


def test_upload_session_round_trip_preserves_resume_state() -> None:
    session = UploadSession(
        session_id="sess_1",
        tenant_id="tenant-a",
        file_id="file-1",
        file_name="data.bin",
        total_size=8,
        expected_hash="abc",
        chunk_size=4,
        total_chunks=2,
        uploaded_chunks={0},
        chunk_hashes={0: "deadbeef"},
    )

    restored = UploadSession.from_dict(session.to_dict())

    assert restored.tenant_id == "tenant-a"
    assert restored.uploaded_chunks == {0}
    assert restored.chunk_hashes == {0: "deadbeef"}
    assert restored.expected_hash == "abc"


@pytest.mark.asyncio
async def test_init_upload_rejects_explicit_zero_chunk_size(tmp_path: Path) -> None:
    upload_manager = manager(tmp_path)

    with pytest.raises(ValueError, match="chunk_size"):
        await upload_manager.init_upload(
            tenant_id="tenant-a",
            file_id="file-1",
            file_name="data.bin",
            total_size=4,
            chunk_size=0,
        )


@pytest.mark.asyncio
async def test_session_resumes_from_shared_cache(tmp_path: Path) -> None:
    first = manager(tmp_path)
    session = await first.init_upload(
        tenant_id="tenant-a",
        file_id="file-1",
        file_name="data.bin",
        total_size=4,
    )

    second = manager(tmp_path)
    second.cache = first.cache

    restored = await second.get_session(session.session_id, "tenant-a")
    assert restored is not None
    assert restored.session_id == session.session_id


@pytest.mark.asyncio
async def test_local_session_resumes_after_process_restart(tmp_path: Path) -> None:
    first = manager(tmp_path)
    session = await first.init_upload(
        tenant_id="tenant-a",
        file_id="file-1",
        file_name="data.bin",
        total_size=4,
    )

    second = manager(tmp_path)
    restored = await second.get_session(session.session_id, "tenant-a")

    assert restored is not None
    assert restored.session_id == session.session_id


@pytest.mark.asyncio
async def test_session_expiry_uses_configured_retention(tmp_path: Path) -> None:
    upload = manager(tmp_path)
    upload.config.upload_retention_seconds = 7200
    before = time.time()

    session = await upload.init_upload(
        tenant_id="tenant-a",
        file_id="file-1",
        file_name="data.bin",
        total_size=4,
    )

    assert before + 7200 <= session.expires_at <= time.time() + 7200


@pytest.mark.asyncio
async def test_chunk_validation_rejects_negative_index_and_wrong_size(
    tmp_path: Path,
) -> None:
    upload = manager(tmp_path)
    session = await upload.init_upload(
        tenant_id="tenant-a",
        file_id="file-1",
        file_name="data.bin",
        total_size=8,
    )
    digest = blake3.blake3(b"abcd").hexdigest()

    with pytest.raises(ValueError, match="non-negative"):
        await upload.upload_chunk(session.session_id, -1, b"abcd", digest, "tenant-a")

    with pytest.raises(ValueError, match="size"):
        await upload.upload_chunk(
            session.session_id, 0, b"abc", blake3.blake3(b"abc").hexdigest(), "tenant-a"
        )


@pytest.mark.asyncio
async def test_finalize_verifies_full_digest_and_tenant(tmp_path: Path) -> None:
    upload = manager(tmp_path)
    content = b"abcdefgh"
    session = await upload.init_upload(
        tenant_id="tenant-a",
        file_id="file-1",
        file_name="data.bin",
        total_size=len(content),
        expected_hash=blake3.blake3(content).hexdigest(),
    )

    for index, chunk in enumerate((b"abcd", b"efgh")):
        await upload.upload_chunk(
            session.session_id,
            index,
            chunk,
            blake3.blake3(chunk).hexdigest(),
            "tenant-a",
        )

    with pytest.raises(PermissionError):
        await upload.finalize_upload(session.session_id, "tenant-b")

    result = await upload.finalize_upload(session.session_id, "tenant-a")
    assert Path(result).read_bytes() == content
    assert Path(result).parent.parent.name == "quarantine"
    assert session.status == "quarantined"
    assert stat.S_IMODE(Path(result).stat().st_mode) == 0o600
    assert not Path(f"{result}.part").exists()


@pytest.mark.asyncio
async def test_finalize_never_overwrites_existing_quarantine_file(
    tmp_path: Path,
) -> None:
    upload = manager(tmp_path)
    first = await upload.init_upload(
        tenant_id="tenant-a",
        file_id="same-file",
        file_name="first.bin",
        total_size=4,
    )
    second = await upload.init_upload(
        tenant_id="tenant-a",
        file_id="same-file",
        file_name="second.bin",
        total_size=4,
    )
    for session, content in ((first, b"aaaa"), (second, b"bbbb")):
        await upload.upload_chunk(
            session.session_id,
            0,
            content,
            blake3.blake3(content).hexdigest(),
            "tenant-a",
        )

    published = Path(await upload.finalize_upload(first.session_id, "tenant-a"))
    with pytest.raises(ValueError, match="already uses"):
        await upload.finalize_upload(second.session_id, "tenant-a")

    assert published.read_bytes() == b"aaaa"
    assert second.status == "completed"


@pytest.mark.asyncio
async def test_cancel_does_not_report_success_after_finalization_starts(
    tmp_path: Path,
) -> None:
    upload = manager(tmp_path)
    session = await upload.init_upload(
        tenant_id="tenant-a",
        file_id="file-1",
        file_name="data.bin",
        total_size=4,
    )
    session.status = "finalizing"

    assert await upload.cancel_upload(session.session_id, "tenant-a") is False
    assert await upload.get_session(session.session_id, "tenant-a") is session


@pytest.mark.asyncio
async def test_file_id_cannot_escape_storage_root(tmp_path: Path) -> None:
    upload = manager(tmp_path)
    with pytest.raises(ValueError, match="file_id"):
        await upload.init_upload(
            tenant_id="tenant-a",
            file_id="../../escape",
            file_name="data.bin",
            total_size=4,
        )


@pytest.mark.asyncio
async def test_client_chunk_hash_cannot_escape_storage_root(tmp_path: Path) -> None:
    upload = manager(tmp_path)
    with pytest.raises(ValueError, match="client chunk hash"):
        await upload.init_upload(
            tenant_id="tenant-a",
            file_id="file-1",
            file_name="data.bin",
            total_size=4,
            client_chunk_hashes={0: "../../outside"},
        )
    assert not (tmp_path.parent / "outside").exists()


@pytest.mark.asyncio
async def test_upload_rejects_symlink_chunk_storage(tmp_path: Path) -> None:
    upload = manager(tmp_path)
    session = await upload.init_upload(
        tenant_id="tenant-a",
        file_id="file-1",
        file_name="data.bin",
        total_size=4,
    )
    content = b"abcd"
    digest = blake3.blake3(content).hexdigest()
    outside = tmp_path / "outside"
    outside.write_bytes(content)
    tenant_dir = upload.chunks_dir / "tenant-a"
    tenant_dir.mkdir(mode=0o700)
    (tenant_dir / digest).symlink_to(outside)

    with pytest.raises(ValueError, match="regular file"):
        await upload.upload_chunk(
            session.session_id,
            0,
            content,
            digest,
            "tenant-a",
        )


def test_upload_storage_directories_are_private(tmp_path: Path) -> None:
    upload = manager(tmp_path)

    for path in (
        upload.chunks_dir,
        upload.files_dir,
        upload.quarantine_dir,
        upload.sessions_dir,
    ):
        assert stat.S_IMODE(path.stat().st_mode) == 0o700


@pytest.mark.asyncio
async def test_upload_reserves_configured_free_disk(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    upload = manager(tmp_path)
    upload.config.upload_min_free_bytes = 10
    monkeypatch.setattr(
        upload_manager_module.shutil,
        "disk_usage",
        lambda _path: SimpleNamespace(free=12),
    )

    with pytest.raises(ValueError, match="disk space"):
        await upload.init_upload(
            tenant_id="tenant-a",
            file_id="file-1",
            file_name="data.bin",
            total_size=4,
        )


def test_upload_cleanup_removes_stale_untrusted_files(tmp_path: Path) -> None:
    upload = manager(tmp_path)
    upload.config.upload_retention_seconds = 3600
    tenant_chunks = upload.chunks_dir / "tenant-a"
    tenant_quarantine = upload.quarantine_dir / "tenant-a"
    tenant_chunks.mkdir(mode=0o700)
    tenant_quarantine.mkdir(mode=0o700)
    stale_chunk = tenant_chunks / ("a" * 64)
    stale_quarantine = tenant_quarantine / "file-a"
    stale_chunk.write_bytes(b"chunk")
    stale_quarantine.write_bytes(b"file")
    stale_time = time.time() - 7200
    for path in (stale_chunk, stale_quarantine):
        path.touch()
        upload_manager_module.os.utime(path, (stale_time, stale_time))
    unsafe_link = tenant_chunks / ("b" * 64)
    unsafe_link.symlink_to(stale_quarantine)

    upload._cleanup_stale_files_sync()

    assert not stale_chunk.exists()
    assert not stale_quarantine.exists()
    assert not unsafe_link.is_symlink()


@pytest.mark.asyncio
async def test_upload_cleanup_removes_expired_session_metadata_and_cache(
    tmp_path: Path,
) -> None:
    upload = manager(tmp_path)
    session = await upload.init_upload(
        tenant_id="tenant-a",
        file_id="file-1",
        file_name="data.bin",
        total_size=4,
    )
    session.expires_at = time.time() - 1
    await upload._persist_session(session)

    await upload.cleanup_expired()

    assert session.session_id not in upload._sessions
    assert not upload._session_path(session.session_id).exists()
    assert not any(session.session_id in key for key in upload.cache.values)
