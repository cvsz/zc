"""Authenticated HTTP compatibility routes for wire clients."""

import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse

from ...core.cache import get_cache
from ...core.auth import Principal, require_roles
from ...core.config import get_config
from ...services.upload_manager import UploadManager, get_upload_manager

router = APIRouter(prefix="/v1/wire", tags=["wire CLI"])


async def get_upload_manager_dependency() -> UploadManager:
    """Return the process upload manager without a sync dependency thread."""
    return get_upload_manager()


async def _read_bounded_stream(request: Request, limit: int) -> bytes:
    """Read one chunk without buffering beyond its session-specific budget."""
    body = bytearray()
    async for part in request.stream():
        body.extend(part)
        if len(body) > limit:
            raise ValueError("Chunk body exceeds the expected size")
    return bytes(body)


async def _read_bounded_upload(upload: Any, limit: int) -> bytes:
    """Read one multipart upload part with the same hard chunk budget."""
    body = bytearray()
    while True:
        part = upload.read(64 * 1024)
        if hasattr(part, "__await__"):
            part = await part
        if not part:
            break
        body.extend(part)
        if len(body) > limit:
            raise ValueError("Chunk body exceeds the expected size")
    return bytes(body)


@router.get("/health/live")
async def liveness_probe() -> dict[str, Any]:
    """Return the minimal process liveness contract."""
    return {
        "status": "alive",
        "version": get_config().version,
        "timestamp": time.time(),
    }


@router.get("/health/ready")
async def readiness_probe(
    _principal: Principal = Depends(require_roles("admin", "viewer")),
) -> Response:
    """Return authenticated compatibility readiness without internal paths."""
    cache = get_cache()
    upload_mgr = get_upload_manager()

    cache_health = (
        await cache.health_check() if cache._connected else {"redis_connected": False}
    )
    upload_health = await upload_mgr.health_check()

    cache_ready = bool(
        cache_health.get("redis_connected", False) or not get_config().redis_enabled
    )
    ready = cache_ready and bool(upload_health["ready"])
    payload = {
        "status": "ready" if ready else "not_ready",
        "checks": {
            "cache": {"ready": cache_ready},
            "upload": upload_health,
        },
        "timestamp": time.time(),
    }
    return JSONResponse(
        payload,
        status_code=200 if ready else 503,
    )


@router.get("/health/full")
async def full_health_check(
    _principal: Principal = Depends(require_roles("admin")),
) -> Response:
    """Return the authenticated compatibility health summary."""
    config = get_config()
    cache = get_cache()
    upload_mgr = get_upload_manager()

    cache_ready = bool(
        (cache._connected and (await cache.health_check()).get("redis_connected"))
        or not config.redis_enabled
    )
    upload_health = await upload_mgr.health_check()
    checks = {
        "config": {
            "environment": config.environment,
            "redis_enabled": config.redis_enabled,
            "protobuf_enabled": config.protobuf_enabled,
        },
        "cache": {"ready": cache_ready},
        "upload": upload_health,
    }
    cache_score = int(cache_ready)
    upload_score = int(bool(upload_health["ready"]))
    healthy_count = cache_score + upload_score

    payload = {
        "status": "healthy" if healthy_count == 2 else "degraded",
        "health_score": healthy_count / 2,
        "checks": checks,
        "timestamp": time.time(),
    }
    return JSONResponse(
        payload,
        status_code=200 if healthy_count == 2 else 503,
    )


@router.post("/upload/init")
async def init_upload(
    request: Request,
    upload_mgr: UploadManager = Depends(get_upload_manager_dependency),
    principal: Principal = Depends(
        require_roles("admin", "developer", "agent", "cli_service")
    ),
) -> Response:
    """
    Initialize a file upload session.

    Expects Protobuf-encoded UploadInitRequest or JSON fallback.
    Returns missing chunk indices for delta uploads.
    """
    start_time = time.perf_counter()
    content_type = request.headers.get("content-type", "")

    try:
        # Parse request body
        body = await request.body()

        if "protobuf" in content_type or "application/x-protobuf" in content_type:
            # Parse Protobuf
            from ...proto import wire_pb2

            req = wire_pb2.UploadInitRequest()  # type: ignore
            req.ParseFromString(body)
            file_id = req.file_id
            file_name = req.file_name
            total_size = req.total_size
            expected_hash = req.content_hash or None
            client_hashes = (
                {str(i): hash_val for i, hash_val in enumerate(req.existing_chunks)}
                if req.existing_chunks
                else {}
            )
        else:
            # JSON fallback
            import json

            data = json.loads(body.decode("utf-8"))

            file_id = data.get("file_id")
            file_name = data.get("file_name")
            total_size = data.get("total_size")
            expected_hash = data.get("content_hash")
            client_hashes = data.get("client_chunk_hashes", {})

            if not all([file_id, file_name, total_size]):
                raise HTTPException(
                    400, "Missing required fields: file_id, file_name, total_size"
                )

        # Initialize upload session
        session = await upload_mgr.init_upload(
            file_id=file_id,
            file_name=file_name,
            total_size=int(total_size),
            tenant_id=principal.tenant_id,
            expected_hash=expected_hash,
            client_chunk_hashes={int(k): v for k, v in client_hashes.items()}
            if client_hashes
            else None,
        )

        elapsed_ms = (time.perf_counter() - start_time) * 1000

        response_data = {
            "session_id": session.session_id,
            "missing_chunk_indices": session.missing_chunks(),
            "chunk_size": session.chunk_size,
            "total_chunks": session.total_chunks,
            "progress_percent": session.progress_percent(),
            "_metadata": {
                "elapsed_ms": round(elapsed_ms, 2),
                "cached": False,
            },
        }

        # Return Protobuf if requested, else JSON
        if "protobuf" in request.headers.get("accept", ""):
            from ...proto import wire_pb2

            resp = wire_pb2.UploadInitResponse(  # type: ignore
                upload_session_id=session.session_id,
                missing_chunk_indices=session.missing_chunks(),
                chunk_size=session.chunk_size,
                estimated_transfer_bytes=(
                    len(session.missing_chunks()) * session.chunk_size
                ),
            )
            return Response(
                content=resp.SerializeToString(), media_type="application/x-protobuf"
            )

        return JSONResponse(content=response_data)

    except ValueError as e:
        raise HTTPException(400, str(e))
    except PermissionError:
        raise HTTPException(403, "Upload session belongs to another tenant")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(500, "Upload initialization failed")


@router.post("/upload/chunk")
async def upload_chunk(
    request: Request,
    upload_mgr: UploadManager = Depends(get_upload_manager_dependency),
    principal: Principal = Depends(
        require_roles("admin", "developer", "agent", "cli_service")
    ),
) -> Response:
    """
    Upload a single file chunk.

    Supports parallel chunk uploads with integrity verification.
    """
    start_time = time.perf_counter()

    try:
        content_type = request.headers.get("content-type", "")

        # Protobuf Fast Path
        if "protobuf" in content_type or "application/x-protobuf" in content_type:
            from ...proto import wire_pb2

            body = await _read_bounded_stream(
                request,
                get_config().upload_chunk_size + 64 * 1024,
            )
            req = wire_pb2.ChunkUploadRequest()  # type: ignore
            req.ParseFromString(body)

            success = await upload_mgr.upload_chunk(
                session_id=req.session_id,
                chunk_index=req.chunk_index,
                data=req.data,
                chunk_hash=req.chunk_hash,
                tenant_id=principal.tenant_id,
            )

            elapsed_ms = (time.perf_counter() - start_time) * 1000
            progress = await upload_mgr.get_progress(
                req.session_id,
                principal.tenant_id,
            )

            if "protobuf" in request.headers.get("accept", ""):
                resp = wire_pb2.ChunkUploadResponse(  # type: ignore
                    success=success,
                    bytes_received=len(req.data),
                    progress_percent=progress.get("progress_percent", 0.0),
                )
                return Response(
                    content=resp.SerializeToString(),
                    media_type="application/x-protobuf",
                )

            return JSONResponse(
                content={
                    "success": success,
                    "chunk_index": req.chunk_index,
                    "progress": progress,
                    "_metadata": {"elapsed_ms": round(elapsed_ms, 2)},
                }
            )

        # Raw and multipart uploads use headers so the server can resolve the
        # session-specific body budget before consuming untrusted file data.
        session_id_val: Any = request.headers.get("x-upload-session")
        if not session_id_val:
            raise HTTPException(400, "Missing session_id")

        session_id = str(session_id_val)

        # Get chunk index
        chunk_index_val: Any = request.headers.get("x-chunk-index")
        if chunk_index_val is None:
            raise HTTPException(400, "Missing chunk_index")

        chunk_index = int(str(chunk_index_val))

        # Get chunk hash for verification
        chunk_hash_val: Any = request.headers.get("x-chunk-hash")
        if not chunk_hash_val:
            raise HTTPException(400, "Missing chunk_hash for integrity verification")

        chunk_hash = str(chunk_hash_val)
        session = await upload_mgr.get_session(session_id, principal.tenant_id)
        if session is None:
            raise HTTPException(404, "Upload session not found")
        if chunk_index < 0 or chunk_index >= session.total_chunks:
            raise ValueError("Chunk index is outside the upload range")
        expected_size = session.chunk_size
        if chunk_index == session.total_chunks - 1:
            expected_size = session.total_size - (chunk_index * session.chunk_size)

        # Get chunk data
        if "multipart" in content_type:
            content_length = request.headers.get("content-length")
            if content_length is not None:
                try:
                    declared_size = int(content_length)
                except ValueError as error:
                    raise ValueError("Invalid Content-Length header") from error
                if declared_size < 0:
                    raise ValueError("Invalid Content-Length header")
                if declared_size > expected_size + (64 * 1024):
                    raise ValueError(
                        "Multipart chunk request exceeds its expected size"
                    )
            form = await request.form()
            chunk_file = form.get("data")
            if hasattr(chunk_file, "read"):
                chunk_data = await _read_bounded_upload(chunk_file, expected_size)
            else:
                chunk_data = (
                    str(chunk_file).encode() if isinstance(chunk_file, str) else b""
                )
        else:
            chunk_data = await _read_bounded_stream(request, expected_size)

        # Upload chunk
        success = await upload_mgr.upload_chunk(
            session_id=session_id,
            chunk_index=chunk_index,
            data=chunk_data,
            chunk_hash=chunk_hash,
            tenant_id=principal.tenant_id,
        )

        elapsed_ms = (time.perf_counter() - start_time) * 1000

        # Get updated progress
        progress = await upload_mgr.get_progress(
            session_id,
            principal.tenant_id,
        )

        return JSONResponse(
            content={
                "success": success,
                "chunk_index": chunk_index,
                "progress": progress,
                "_metadata": {
                    "elapsed_ms": round(elapsed_ms, 2),
                },
            }
        )

    except ValueError as e:
        raise HTTPException(400, str(e))
    except PermissionError:
        raise HTTPException(403, "Upload session belongs to another tenant")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(500, "Chunk upload failed")


@router.post("/upload/finalize/{session_id}")
async def finalize_upload(
    session_id: str,
    upload_mgr: UploadManager = Depends(get_upload_manager_dependency),
    principal: Principal = Depends(
        require_roles("admin", "developer", "agent", "cli_service")
    ),
) -> dict[str, Any]:
    """Finalize an upload by assembling all chunks."""
    try:
        await upload_mgr.finalize_upload(session_id, principal.tenant_id)

        return {
            "success": True,
            "session_id": session_id,
            "status": "quarantined",
        }
    except ValueError as e:
        raise HTTPException(400, str(e))
    except PermissionError:
        raise HTTPException(403, "Upload session belongs to another tenant")
    except Exception:
        raise HTTPException(500, "Finalization failed")


@router.get("/upload/progress/{session_id}")
async def get_upload_progress(
    session_id: str,
    upload_mgr: UploadManager = Depends(get_upload_manager_dependency),
    principal: Principal = Depends(
        require_roles("admin", "developer", "agent", "cli_service", "viewer")
    ),
) -> dict[str, Any]:
    """Get real-time upload progress."""
    try:
        progress = await upload_mgr.get_progress(session_id, principal.tenant_id)
    except ValueError as error:
        raise HTTPException(400, str(error))
    if "error" in progress:
        raise HTTPException(404, "Upload session not found")
    return progress


@router.delete("/upload/cancel/{session_id}")
async def cancel_upload(
    session_id: str,
    upload_mgr: UploadManager = Depends(get_upload_manager_dependency),
    principal: Principal = Depends(
        require_roles("admin", "developer", "agent", "cli_service")
    ),
) -> dict[str, Any]:
    """Cancel an active upload session."""
    success = await upload_mgr.cancel_upload(session_id, principal.tenant_id)
    return {"success": success, "session_id": session_id}


@router.get("/cache/stats")
async def cache_stats(
    _principal: Principal = Depends(require_roles("admin")),
) -> dict[str, Any]:
    """Get cache performance statistics."""
    cache = get_cache()
    return await cache.health_check()


@router.get("/metrics/performance")
async def performance_metrics(
    _principal: Principal = Depends(require_roles("admin", "viewer")),
) -> dict[str, Any]:
    """Get API performance metrics."""
    from ...core.http_client import get_http_client

    http_client = get_http_client()
    http_stats = await http_client.metrics.get_stats()

    cache = get_cache()
    cache_stats = await cache.health_check()

    return {
        "http": http_stats,
        "cache": cache_stats,
        "timestamp": time.time(),
    }
