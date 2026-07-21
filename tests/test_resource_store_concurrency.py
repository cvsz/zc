"""Concurrency regression tests for tenant resource persistence."""

from pathlib import Path

import pytest

from app.services.chat_session_store import AtomicChatSessionStore
from app.services.resource_store import ResourceConflictError, ResourceStore


@pytest.mark.asyncio
async def test_stale_resource_replace_is_rejected(tmp_path: Path) -> None:
    store = ResourceStore(tmp_path / "resources.sqlite3")
    created = await store.create(
        "tenant-a",
        "projects",
        "project-a",
        {"name": "original"},
    )
    first_reader = dict(created)
    stale_reader = dict(created)

    first_reader["name"] = "first update"
    updated = await store.replace(
        "tenant-a",
        "projects",
        "project-a",
        first_reader,
    )
    stale_reader["name"] = "stale update"

    with pytest.raises(ResourceConflictError, match="modified"):
        await store.replace(
            "tenant-a",
            "projects",
            "project-a",
            stale_reader,
        )

    persisted = await store.get("tenant-a", "projects", "project-a")
    assert persisted["name"] == "first update"
    assert persisted["updated_at"] == updated["updated_at"]


@pytest.mark.asyncio
async def test_stale_chat_session_replace_is_rejected(tmp_path: Path) -> None:
    store = AtomicChatSessionStore(tmp_path / "chat")
    created = await store.create(
        "tenant-a",
        "chat",
        "chat_0123456789abcdef0123456789abcdef",
        {"title": "original"},
    )
    first_reader = dict(created)
    stale_reader = dict(created)

    first_reader["title"] = "first update"
    await store.replace(
        "tenant-a",
        "chat",
        created["id"],
        first_reader,
    )
    stale_reader["title"] = "stale update"

    with pytest.raises(ResourceConflictError, match="modified"):
        await store.replace(
            "tenant-a",
            "chat",
            created["id"],
            stale_reader,
        )
