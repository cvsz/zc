"""Tenant isolation and filesystem safety tests for local gRPC delta storage."""

from __future__ import annotations

import stat
from pathlib import Path

import pytest

from app.services.delta.sync_service import DeltaSyncService


@pytest.mark.asyncio
async def test_delta_cas_is_tenant_scoped_and_private(tmp_path: Path) -> None:
    service = DeltaSyncService(tmp_path, max_file_size=1024)
    digest = await service.store_file("tenant-a", b"private")

    assert await service.get_file_by_hash("tenant-a", digest) == b"private"
    assert await service.get_file_by_hash("tenant-b", digest) is None

    stored = service._get_cas_path("tenant-a", digest)
    assert stat.S_IMODE(stored.stat().st_mode) == 0o600
    assert stat.S_IMODE(stored.parent.stat().st_mode) == 0o700


@pytest.mark.asyncio
async def test_delta_cas_rejects_path_traversal_and_invalid_digest(
    tmp_path: Path,
) -> None:
    service = DeltaSyncService(tmp_path, max_file_size=1024)

    with pytest.raises(ValueError, match="tenant_id"):
        await service.get_file_by_hash("../../other", "a" * 64)
    with pytest.raises(ValueError, match="content_hash"):
        await service.get_file_by_hash("tenant-a", "../../other")


@pytest.mark.asyncio
async def test_delta_cas_rejects_symlink_entry(tmp_path: Path) -> None:
    service = DeltaSyncService(tmp_path, max_file_size=1024)
    content = b"private"
    digest = await service.store_file("tenant-a", content)
    stored = service._get_cas_path("tenant-a", digest)
    stored.unlink()
    outside = tmp_path / "outside"
    outside.write_bytes(content)
    stored.symlink_to(outside)

    with pytest.raises(ValueError, match="regular file"):
        await service.get_file_by_hash("tenant-a", digest)


@pytest.mark.asyncio
async def test_delta_service_rejects_oversized_content(tmp_path: Path) -> None:
    service = DeltaSyncService(tmp_path, max_file_size=4)

    with pytest.raises(ValueError, match="size limit"):
        await service.store_file("tenant-a", b"12345")


@pytest.mark.asyncio
async def test_empty_delta_target_requires_full_upload(tmp_path: Path) -> None:
    service = DeltaSyncService(tmp_path)
    base_hash = await service.store_file("tenant-a", b"base")

    result = await service.compute_delta("tenant-a", base_hash, b"", "naive")

    assert result.success is False
    assert result.error_message == "Empty targets must use a full upload"
