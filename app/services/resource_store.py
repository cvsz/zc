"""Tenant-isolated SQLite repository for migrated CLI resources."""

from __future__ import annotations

import asyncio
import builtins
import json
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


class ResourceNotFoundError(LookupError):
    """A resource is absent from the requesting tenant."""


class ResourceConflictError(RuntimeError):
    """A resource conflicts with existing tenant state."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _next_timestamp(previous: str) -> str:
    """Return a UTC revision timestamp strictly newer than the previous one."""
    now = datetime.now(timezone.utc)
    previous_time = datetime.fromisoformat(previous)
    if now <= previous_time:
        now = previous_time + timedelta(microseconds=1)
    return now.isoformat()


class ResourceStore:
    """Store JSON resources with tenant included in every primary key."""

    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path
        if self.database_path.is_symlink():
            raise RuntimeError("Resource database must not be a symlink")
        self.database_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.database_path.parent.is_symlink():
            raise RuntimeError("Resource database directory must not be a symlink")
        os.chmod(self.database_path.parent, 0o700)
        self._initialized = False
        self._init_lock = asyncio.Lock()

    def _connect(self) -> sqlite3.Connection:
        if self.database_path.is_symlink():
            raise RuntimeError("Resource database must not be a symlink")
        connection = sqlite3.connect(self.database_path, timeout=10)
        os.chmod(self.database_path, 0o600)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    async def initialize(self) -> None:
        if self._initialized:
            return
        async with self._init_lock:
            if self._initialized:
                return
            await asyncio.to_thread(self._initialize_sync)
            self._initialized = True

    def _initialize_sync(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS resources (
                    tenant_id TEXT NOT NULL,
                    domain TEXT NOT NULL,
                    resource_id TEXT NOT NULL,
                    data TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (tenant_id, domain, resource_id)
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS resources_tenant_domain_updated
                ON resources (tenant_id, domain, updated_at DESC, resource_id)
                """
            )

    async def create(
        self,
        tenant_id: str,
        domain: str,
        resource_id: str,
        data: dict[str, Any],
    ) -> dict[str, Any]:
        await self.initialize()
        return await asyncio.to_thread(
            self._create_sync, tenant_id, domain, resource_id, data
        )

    def _create_sync(
        self,
        tenant_id: str,
        domain: str,
        resource_id: str,
        data: dict[str, Any],
    ) -> dict[str, Any]:
        now = _now()
        document = {**data, "id": resource_id, "created_at": now, "updated_at": now}
        try:
            with self._connect() as connection:
                connection.execute(
                    """
                    INSERT INTO resources
                        (tenant_id, domain, resource_id, data, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        tenant_id,
                        domain,
                        resource_id,
                        json.dumps(document, separators=(",", ":")),
                        now,
                        now,
                    ),
                )
        except sqlite3.IntegrityError as exc:
            raise ResourceConflictError(f"{domain} resource already exists") from exc
        return document

    async def get(
        self, tenant_id: str, domain: str, resource_id: str
    ) -> dict[str, Any]:
        await self.initialize()
        return await asyncio.to_thread(self._get_sync, tenant_id, domain, resource_id)

    def _get_sync(
        self, tenant_id: str, domain: str, resource_id: str
    ) -> dict[str, Any]:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT data FROM resources
                WHERE tenant_id = ? AND domain = ? AND resource_id = ?
                """,
                (tenant_id, domain, resource_id),
            ).fetchone()
        if row is None:
            raise ResourceNotFoundError(f"{domain} resource not found")
        return dict(json.loads(row["data"]))

    async def list(
        self,
        tenant_id: str,
        domain: str,
        *,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[builtins.list[dict[str, Any]], int]:
        await self.initialize()
        return await asyncio.to_thread(
            self._list_sync, tenant_id, domain, limit, offset
        )

    def _list_sync(
        self, tenant_id: str, domain: str, limit: int, offset: int
    ) -> tuple[builtins.list[dict[str, Any]], int]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT data FROM resources
                WHERE tenant_id = ? AND domain = ?
                ORDER BY updated_at DESC, resource_id
                LIMIT ? OFFSET ?
                """,
                (tenant_id, domain, limit, offset),
            ).fetchall()
            total = int(
                connection.execute(
                    """
                    SELECT COUNT(*) FROM resources
                    WHERE tenant_id = ? AND domain = ?
                    """,
                    (tenant_id, domain),
                ).fetchone()[0]
            )
        return [dict(json.loads(row["data"])) for row in rows], total

    async def replace(
        self,
        tenant_id: str,
        domain: str,
        resource_id: str,
        data: dict[str, Any],
    ) -> dict[str, Any]:
        await self.initialize()
        return await asyncio.to_thread(
            self._replace_sync, tenant_id, domain, resource_id, data
        )

    def _replace_sync(
        self,
        tenant_id: str,
        domain: str,
        resource_id: str,
        data: dict[str, Any],
    ) -> dict[str, Any]:
        existing = self._get_sync(tenant_id, domain, resource_id)
        expected_updated_at = data.get("updated_at")
        if (
            expected_updated_at is not None
            and expected_updated_at != existing["updated_at"]
        ):
            raise ResourceConflictError(f"{domain} resource was modified")
        document = {
            **data,
            "id": resource_id,
            "created_at": existing["created_at"],
            "updated_at": _next_timestamp(existing["updated_at"]),
        }
        with self._connect() as connection:
            result = connection.execute(
                """
                UPDATE resources SET data = ?, updated_at = ?
                WHERE tenant_id = ? AND domain = ? AND resource_id = ?
                  AND updated_at = ?
                """,
                (
                    json.dumps(document, separators=(",", ":")),
                    document["updated_at"],
                    tenant_id,
                    domain,
                    resource_id,
                    existing["updated_at"],
                ),
            )
        if result.rowcount != 1:
            raise ResourceConflictError(f"{domain} resource was modified")
        return document

    async def delete(self, tenant_id: str, domain: str, resource_id: str) -> None:
        await self.initialize()
        deleted = await asyncio.to_thread(
            self._delete_sync, tenant_id, domain, resource_id
        )
        if not deleted:
            raise ResourceNotFoundError(f"{domain} resource not found")

    def _delete_sync(self, tenant_id: str, domain: str, resource_id: str) -> bool:
        with self._connect() as connection:
            result = connection.execute(
                """
                DELETE FROM resources
                WHERE tenant_id = ? AND domain = ? AND resource_id = ?
                """,
                (tenant_id, domain, resource_id),
            )
        return result.rowcount == 1


__all__ = [
    "ResourceConflictError",
    "ResourceNotFoundError",
    "ResourceStore",
]
