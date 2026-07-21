"""Authenticated localhost gRPC compatibility service."""

import asyncio
import time
from collections.abc import AsyncIterator
from concurrent import futures
from pathlib import Path
from typing import Any, Optional, cast

import grpc
from grpc.aio import Server, ServicerContext

# Import generated protobuf classes
from app.proto import wire_pb2, wire_pb2_grpc
from app.core.auth import Principal, verify_token
from app.core.config import get_config
from app.services.delta.sync_service import DeltaSyncService
from app.services.upload_manager import UploadManager


class WireServiceServicer:
    """
    gRPC service implementation for wire CLI operations.

    Implements the RPC methods declared in ``wire.proto`` using the same
    tenant-scoped local upload and delta stores as the HTTP runtime.
    """

    def __init__(self, upload_manager: UploadManager, delta_service: DeltaSyncService):
        self.upload_manager = upload_manager
        self.delta_service = delta_service

    async def _authorize(
        self, context: ServicerContext, allowed_roles: set[str]
    ) -> Principal:
        """Authenticate gRPC metadata and enforce role membership."""
        config = get_config()
        if not config.auth_required:
            return Principal("development", "default", frozenset({"admin"}))
        metadata = {
            item.key.lower(): item.value for item in context.invocation_metadata()
        }
        authorization = metadata.get("authorization", "")
        if not authorization.startswith("Bearer "):
            await context.abort(
                grpc.StatusCode.UNAUTHENTICATED, "Bearer token required"
            )
        payload = verify_token(authorization[7:])
        if not payload or not payload.get("sub"):
            await context.abort(grpc.StatusCode.UNAUTHENTICATED, "Invalid bearer token")
        payload = cast(dict[str, Any], payload)
        raw_roles = payload["roles"]
        roles = frozenset(str(role) for role in raw_roles if role)
        if not roles.intersection(allowed_roles):
            await context.abort(
                grpc.StatusCode.PERMISSION_DENIED, "Insufficient permissions"
            )
        return Principal(
            str(payload["sub"]),
            str(payload["tenant_id"]),
            roles,
        )

    async def InitUpload(
        self,
        request: Any,  # wire_pb2.UploadInitRequest
        context: ServicerContext,
    ) -> Any:  # wire_pb2.UploadInitResponse
        """Initialize a new file upload session."""
        principal = await self._authorize(
            context, {"admin", "developer", "agent", "cli_service"}
        )
        try:
            existing_hashes = {
                index: value
                for index, value in enumerate(request.existing_chunks)
                if value
            }

            result = await self.upload_manager.init_upload(
                file_id=request.file_id,
                file_name=getattr(request, "file_name", request.file_id),
                total_size=request.total_size,
                tenant_id=principal.tenant_id,
                expected_hash=request.content_hash or None,
                client_chunk_hashes=existing_hashes,
            )

            return wire_pb2.UploadInitResponse(  # type: ignore[attr-defined]
                upload_session_id=result.session_id,
                missing_chunk_indices=result.missing_chunks(),
                chunk_size=result.chunk_size,
                estimated_transfer_bytes=len(result.missing_chunks())
                * result.chunk_size,
                storage_endpoint="",
            )
        except (ValueError, PermissionError):
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT,
                "Upload initialization rejected",
            )
        except Exception:
            await context.abort(
                grpc.StatusCode.INTERNAL,
                "Upload initialization failed",
            )

    async def UploadChunk(
        self,
        request: Any,  # wire_pb2.ChunkUploadRequest
        context: ServicerContext,
    ) -> Any:  # wire_pb2.ChunkUploadResponse
        """Process a single chunk upload."""
        principal = await self._authorize(
            context, {"admin", "developer", "agent", "cli_service"}
        )
        try:
            success = await self.upload_manager.upload_chunk(
                session_id=request.session_id,
                chunk_index=request.chunk_index,
                data=request.data,
                chunk_hash=request.chunk_hash,
                tenant_id=principal.tenant_id,
            )

            session = await self.upload_manager.get_session(
                request.session_id,
                principal.tenant_id,
            )
            if session is None:
                await context.abort(grpc.StatusCode.NOT_FOUND, "Session not found")
            session = cast(Any, session)

            return wire_pb2.ChunkUploadResponse(  # type: ignore[attr-defined]
                success=success,
                chunk_storage_key=f"chunk_{request.chunk_index}",
                bytes_received=len(request.data),
                progress_percent=session.progress_percent(),
            )
        except grpc.RpcError:
            raise
        except (ValueError, PermissionError):
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT,
                "Chunk upload rejected",
            )
        except Exception:
            await context.abort(
                grpc.StatusCode.INTERNAL,
                "Chunk upload failed",
            )

    async def StreamUploadProgress(
        self,
        request: Any,  # wire_pb2.UploadProgressRequest
        context: ServicerContext,
    ) -> AsyncIterator[Any]:  # wire_pb2.UploadProgressStream
        """Server-side streaming for real-time upload progress."""
        principal = await self._authorize(
            context, {"admin", "developer", "agent", "cli_service", "viewer"}
        )
        session_id = request.session_id

        try:
            upload_session = await self.upload_manager.get_session(
                session_id,
                principal.tenant_id,
            )
        except PermissionError:
            await context.abort(grpc.StatusCode.NOT_FOUND, "Session not found")
        if upload_session is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, "Session not found")

        # Stream progress updates every 500ms
        while True:
            if context.cancelled():
                break

            upload_session = await self.upload_manager.get_session(
                session_id,
                principal.tenant_id,
            )
            if upload_session is None:
                await context.abort(grpc.StatusCode.NOT_FOUND, "Session not found")
            upload_session = cast(Any, upload_session)

            chunks_received = len(upload_session.uploaded_chunks)
            total_size = upload_session.total_size
            chunk_size = upload_session.chunk_size
            total_chunks = upload_session.total_chunks
            bytes_transferred = min(
                chunks_received * chunk_size,
                total_size,
            )
            elapsed_seconds = max(time.time() - upload_session.created_at, 0.001)
            bytes_per_second = bytes_transferred / elapsed_seconds
            transfer_rate_mbps = bytes_per_second * 8 / 1_000_000
            remaining_bytes = max(0, total_size - bytes_transferred)
            eta_seconds = (
                int(remaining_bytes / bytes_per_second) if bytes_per_second > 0 else 0
            )

            yield wire_pb2.UploadProgressStream(  # type: ignore[attr-defined]
                session_id=session_id,
                percent_complete=upload_session.progress_percent(),
                bytes_transferred=bytes_transferred,
                bytes_total=total_size,
                transfer_rate_mbps=transfer_rate_mbps,
                eta_seconds=eta_seconds,
            )

            if chunks_received >= total_chunks:
                break

            await asyncio.sleep(0.5)

    async def SyncDelta(
        self,
        request: Any,  # wire_pb2.DeltaSyncRequest
        context: ServicerContext,
    ) -> Any:  # wire_pb2.DeltaSyncResponse
        """Process delta synchronization request."""
        principal = await self._authorize(
            context, {"admin", "developer", "agent", "cli_service"}
        )
        try:
            started_at = time.perf_counter()
            reconstructed, result_hash = await self.delta_service.apply_patch(
                tenant_id=principal.tenant_id,
                base_hash=request.base_version_hash,
                patch_data=request.delta_patch,
                algorithm=request.patch_algorithm,
            )

            if reconstructed is None:
                await context.abort(
                    grpc.StatusCode.FAILED_PRECONDITION,
                    "Delta patch could not be applied",
                )
            reconstructed = cast(bytes, reconstructed)
            if (
                len(request.target_version_hash) != 64
                or result_hash != request.target_version_hash
            ):
                await context.abort(
                    grpc.StatusCode.INVALID_ARGUMENT,
                    "Delta target digest mismatch",
                )

            stored_hash = await self.delta_service.store_file(
                principal.tenant_id,
                reconstructed,
            )
            original_size = len(reconstructed)
            patch_size = len(request.delta_patch)
            bytes_saved = original_size - patch_size

            return wire_pb2.DeltaSyncResponse(  # type: ignore[attr-defined]
                success=True,
                new_version_hash=stored_hash,
                bytes_saved=bytes_saved,
                patch_apply_time_ms=int((time.perf_counter() - started_at) * 1000),
            )
        except grpc.RpcError:
            raise
        except (ValueError, PermissionError):
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT,
                "Delta synchronization rejected",
            )
        except Exception:
            await context.abort(
                grpc.StatusCode.INTERNAL,
                "Delta synchronization failed",
            )

    async def HealthCheck(
        self,
        request: Any,  # wire_pb2.HealthCheckRequest
        context: ServicerContext,
    ) -> Any:  # wire_pb2.HealthCheckResponse
        """Perform health check with optional metrics."""
        import psutil

        await self._authorize(
            context,
            {"admin", "developer", "agent", "cli_service", "viewer"},
        )
        config = get_config()
        uptime = time.time() - psutil.Process().create_time()
        (
            active_sessions,
            pending_uploads,
        ) = await self.upload_manager.get_session_counts()
        upload_health = await self.upload_manager.health_check()

        return wire_pb2.HealthCheckResponse(  # type: ignore[attr-defined]
            status="healthy" if upload_health["ready"] else "degraded",
            version=config.version,
            uptime_seconds=int(uptime),
            latency_p50_ms=0.0,
            latency_p99_ms=0.0,
            active_connections=active_sessions,
            pending_uploads=pending_uploads,
        )


async def create_grpc_server(
    host: str = "127.0.0.1",
    port: int = 50051,
    upload_manager: Optional[UploadManager] = None,
    delta_service: Optional[DeltaSyncService] = None,
    max_workers: int = 10,
    max_message_size: int = 50 * 1024 * 1024,  # 50MB
) -> Server:
    """
    Create and configure gRPC server with optimized settings.

    Args:
        host: Bind address
        port: Listen port
        upload_manager: Upload service instance
        delta_service: Delta sync service instance
        max_workers: Maximum concurrent RPC handlers
        max_message_size: Maximum message size in bytes

    Returns:
        Configured gRPC aio server
    """

    # Create server with optimization options
    options = [
        ("grpc.max_concurrent_streams", 100),
        ("grpc.max_send_message_length", max_message_size),
        ("grpc.max_receive_message_length", max_message_size),
        ("grpc.keepalive_time_ms", 30000),  # 30 second keepalive
        ("grpc.keepalive_timeout_ms", 5000),
        ("grpc.http2.min_ping_interval_without_data_ms", 10000),
        ("grpc.http2.max_ping_strikes", 2),
    ]

    server = grpc.aio.server(
        futures.ThreadPoolExecutor(max_workers=max_workers), options=options
    )

    config = get_config()

    # Add servicer
    servicer = WireServiceServicer(
        upload_manager=upload_manager or UploadManager(),
        delta_service=delta_service
        or DeltaSyncService(
            config.upload_temp_dir / "delta",
            max_file_size=config.max_message_size,
        ),
    )

    wire_pb2_grpc.add_WireServiceServicer_to_server(servicer, server)

    # Bind to address
    bound_port = server.add_insecure_port(f"{host}:{port}")
    if bound_port == 0:
        raise RuntimeError("gRPC server could not bind to the configured address")

    return server


async def run_grpc_server(host: str = "127.0.0.1", port: int = 50051):
    """Run gRPC server until shutdown signal."""
    from app.core.config import get_config

    server = await create_grpc_server(
        host=host,
        port=port,
        upload_manager=UploadManager(),
        delta_service=DeltaSyncService(
            get_config().upload_temp_dir / "delta",
            max_file_size=get_config().max_message_size,
        ),
    )

    await server.start()
    print(f"[GRPC] Server started on {host}:{port}")

    try:
        await server.wait_for_termination()
    except KeyboardInterrupt:
        await server.stop(grace=5.0)
        print("[GRPC] Server stopped gracefully")
