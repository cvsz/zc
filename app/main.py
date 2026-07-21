"""FastAPI application and supported console entry point for zcoder."""

import argparse
import asyncio
import logging
import time
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import Depends, FastAPI, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .api.v1.routes import router as wire_router
from .api.v1.ai_routes import router as ai_router
from .api.v1.chat_routes import router as chat_router
from .api.v1.resource_routes import router as resource_router
from .core.cache import get_cache, init_cache, shutdown_cache
from .core.auth import Principal, require_roles
from .core.config import get_config
from .core.http_client import init_http_client, shutdown_http_client
from .core.logging import configure_application_logging
from .middleware.rate_limiter import RateLimitMiddleware
from .middleware.cloudflare_access import CloudflareAccessMiddleware
from .middleware.idempotency import IdempotencyMiddleware
from .middleware.request_context import RequestContextMiddleware
from .middleware.request_size import RequestSizeLimitMiddleware
from .services.upload_manager import init_upload_manager
from .services.ai_service import AIService, AIServiceError, UnknownCapabilityError
from .services.domain_resources import StandaloneCapabilityUnavailableError
from .services.ai_provider import close_embedded_litellm
from .services.resource_store import ResourceConflictError, ResourceNotFoundError

logger = logging.getLogger(__name__)
FRONTEND_DIR = Path(__file__).resolve().parents[1] / "webapp" / "frontend-dist"


class ResponseHeadersMiddleware:
    """Add timing and defensive response headers without response buffering."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started_at = time.perf_counter()

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                duration_ms = (time.perf_counter() - started_at) * 1000
                headers = list(message.get("headers", []))
                frontend_path = str(scope.get("path", ""))
                is_frontend = frontend_path in {
                    "/",
                    "/favicon.svg",
                } or frontend_path.startswith("/assets/")
                content_security_policy = (
                    b"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; "
                    b"img-src 'self' data:; connect-src 'self' wss: https:; font-src 'self' data:; "
                    b"object-src 'none'; frame-ancestors 'none'; base-uri 'none'; "
                    b"form-action 'self'"
                    if is_frontend
                    else b"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
                )
                headers.extend(
                    [
                        (b"x-process-time", f"{duration_ms:.2f}ms".encode()),
                        (
                            b"strict-transport-security",
                            b"max-age=31536000; includeSubDomains",
                        ),
                        (b"x-content-type-options", b"nosniff"),
                        (b"x-frame-options", b"DENY"),
                        (b"referrer-policy", b"no-referrer"),
                        (
                            b"content-security-policy",
                            content_security_policy,
                        ),
                    ]
                )
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)


def _set_component_state(
    app: FastAPI, name: str, ready: bool, error: str | None = None
) -> None:
    app.state.components[name] = {"ready": ready, "error": error}


async def _upload_maintenance(upload_manager: object, interval: float) -> None:
    """Periodically enforce local upload retention without another service."""
    cleanup = getattr(upload_manager, "cleanup_expired")
    while True:
        await asyncio.sleep(interval)
        try:
            await cleanup()
        except Exception:
            logger.exception("Upload retention maintenance failed")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Initialize optional integrations and expose their state to readiness."""
    config = get_config()
    config.validate()
    configure_application_logging(config.environment == "production")
    app.state.components = {}

    logger.info(
        "Starting %s v%s in %s", config.app_name, config.version, config.environment
    )

    if config.redis_enabled:
        try:
            await init_cache()
            _set_component_state(app, "redis", True)
        except Exception:  # startup state is reported by /ready
            logger.exception("Cache initialization failed")
            _set_component_state(app, "redis", False, "unavailable")
    else:
        _set_component_state(app, "redis", True, "disabled")
    try:
        await init_http_client()
        _set_component_state(app, "http_client", True)
    except Exception:
        logger.exception("HTTP client initialization failed")
        _set_component_state(app, "http_client", False, "unavailable")

    upload_maintenance_task: asyncio.Task[None] | None = None
    try:
        upload_manager = await init_upload_manager()
        maintenance_interval = min(
            3600.0,
            max(60.0, config.upload_retention_seconds / 4),
        )
        upload_maintenance_task = asyncio.create_task(
            _upload_maintenance(upload_manager, maintenance_interval),
            name="upload-retention-maintenance",
        )
        _set_component_state(app, "upload_manager", True)
    except Exception:
        logger.exception("Upload manager initialization failed")
        _set_component_state(app, "upload_manager", False, "unavailable")

    if config.ai_provider == "litellm":
        if await AIService(config=config).provider_ready():
            _set_component_state(app, "ai_provider", True)
        else:
            _set_component_state(app, "ai_provider", False, "unavailable")
    else:
        _set_component_state(app, "ai_provider", True, "direct")

    if config.protobuf_enabled:
        try:
            from .grpc.wire_servicer import create_grpc_server
            from .services.upload_manager import get_upload_manager

            grpc_server = await create_grpc_server(
                host=config.api_host,
                port=config.api_port + 1,
                upload_manager=get_upload_manager(),
                delta_service=None,
                max_message_size=config.max_message_size,
            )
            await grpc_server.start()
            app.state.grpc_server = grpc_server
            _set_component_state(app, "grpc", True)
        except Exception:
            logger.exception("gRPC server initialization failed")
            _set_component_state(app, "grpc", False, "unavailable")
    else:
        _set_component_state(app, "grpc", True, "disabled")

    yield

    if hasattr(app.state, "grpc_server"):
        await app.state.grpc_server.stop(grace=5.0)
    if upload_maintenance_task is not None:
        upload_maintenance_task.cancel()
        with suppress(asyncio.CancelledError):
            await upload_maintenance_task
    if config.ai_provider == "litellm":
        await close_embedded_litellm()
    await shutdown_http_client()
    await shutdown_cache()


config = get_config()
app = FastAPI(
    title=config.app_name,
    version=config.version,
    description="zcoder API service",
    docs_url="/docs" if config.debug else None,
    redoc_url="/redoc" if config.debug else None,
    openapi_url="/openapi.json" if config.debug else None,
    lifespan=lifespan,
)


@app.exception_handler(ResourceNotFoundError)
async def resource_not_found_handler(
    _request: Request, _exc: ResourceNotFoundError
) -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={
            "error": {
                "code": "not_found",
                "message": "The requested resource was not found.",
            }
        },
    )


@app.exception_handler(ResourceConflictError)
async def resource_conflict_handler(
    _request: Request, _exc: ResourceConflictError
) -> JSONResponse:
    return JSONResponse(
        status_code=409,
        content={
            "error": {
                "code": "resource_conflict",
                "message": "The resource conflicts with existing state.",
            }
        },
    )


@app.exception_handler(UnknownCapabilityError)
async def unknown_capability_handler(
    _request: Request, exc: UnknownCapabilityError
) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "unknown_capability",
                "message": str(exc),
            }
        },
    )


@app.exception_handler(StandaloneCapabilityUnavailableError)
async def standalone_capability_unavailable_handler(
    _request: Request, _exc: StandaloneCapabilityUnavailableError
) -> JSONResponse:
    return JSONResponse(
        status_code=501,
        content={
            "error": {
                "code": "standalone_capability_unavailable",
                "message": "This capability is not available in the standalone runtime.",
            }
        },
    )


@app.exception_handler(AIServiceError)
async def ai_service_error_handler(
    _request: Request, _exc: AIServiceError
) -> JSONResponse:
    return JSONResponse(
        status_code=502,
        content={
            "error": {
                "code": "provider_error",
                "message": "The AI provider could not complete the request.",
            }
        },
    )


@app.exception_handler(ValueError)
async def domain_validation_handler(_request: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "domain_validation_error",
                "message": str(exc),
            }
        },
    )


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, _exc: Exception) -> JSONResponse:
    request_id = getattr(request.state, "request_id", "unknown")
    logger.exception("Unhandled request error", extra={"request_id": request_id})
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "internal_error",
                "message": "The request could not be completed.",
                "request_id": request_id,
            }
        },
        headers={
            "X-Request-ID": request_id,
            "Cache-Control": "no-store",
            "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "no-referrer",
            "Content-Security-Policy": (
                "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
            ),
        },
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=config.cors_origins,
    allow_credentials=bool(config.cors_origins),
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(IdempotencyMiddleware, config=config)
app.add_middleware(
    RequestSizeLimitMiddleware,
    max_body_bytes=config.max_message_size,
)
if config.rate_limit_enabled:
    app.add_middleware(
        RateLimitMiddleware,
        requests_per_minute=config.rate_limit_requests,
        burst=config.rate_limit_requests,
        window_seconds=config.rate_limit_window,
    )
app.add_middleware(CloudflareAccessMiddleware)
app.add_middleware(RequestContextMiddleware)
app.add_middleware(ResponseHeadersMiddleware)

app.include_router(wire_router)
app.include_router(ai_router)
app.include_router(chat_router)
app.include_router(resource_router)
if config.control_panel_enabled:
    from .api.control_panel_rest import router as control_panel_router

    app.include_router(control_panel_router)


@app.get("/v1/meta")
async def metadata(
    _principal: Principal = Depends(
        require_roles("admin", "developer", "agent", "cli_service", "viewer")
    ),
) -> dict[str, str]:
    return {
        "name": config.app_name,
        "version": config.version,
        "description": "zcoder API service",
        "docs": "/docs" if config.debug else "Disabled in production",
        "health": "/v1/wire/health/live",
        "readiness": "/ready",
    }


@app.get("/", include_in_schema=False)
async def root() -> Response:
    """Serve the bundled local-first UI from the supported API process."""
    index = FRONTEND_DIR / "index.html"
    if config.frontend_enabled and index.is_file():
        return FileResponse(index)
    return JSONResponse(
        {
            "name": config.app_name,
            "version": config.version,
            "description": "zcoder API service",
            "frontend": "not built",
            "readiness": "/ready",
        }
    )


@app.get("/favicon.svg", include_in_schema=False)
async def favicon() -> Response:
    icon = FRONTEND_DIR / "favicon.svg"
    if config.frontend_enabled and icon.is_file():
        return FileResponse(icon, media_type="image/svg+xml")
    return Response(status_code=404)


@app.get("/ready")
async def readiness() -> Response:
    components = getattr(app.state, "components", {})
    failed = sorted(name for name, value in components.items() if not value["ready"])
    payload = {
        "status": "ready" if not failed else "degraded",
        "components": components,
        "failed": failed,
    }
    if failed and config.strict_readiness:
        return JSONResponse(payload, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
    return JSONResponse(payload, status_code=status.HTTP_200_OK)


@app.get("/health/cache")
async def cache_health(
    _principal: Principal = Depends(require_roles("admin")),
) -> dict:
    """Expose cache state without leaking connection credentials."""
    return await get_cache().health_check()


if config.frontend_enabled and (FRONTEND_DIR / "assets").is_dir():
    app.mount(
        "/assets",
        StaticFiles(directory=FRONTEND_DIR / "assets"),
        name="frontend-assets",
    )


def run_server(
    host: Optional[str] = None,
    port: Optional[int] = None,
    workers: Optional[int] = None,
) -> None:
    cfg = get_config()
    cfg.validate()
    effective_host = host if host is not None else cfg.api_host
    effective_port = port if port is not None else cfg.api_port
    effective_workers = workers if workers is not None else cfg.api_workers
    if cfg.environment == "production" and effective_host != "127.0.0.1":
        raise RuntimeError("Production server must bind to 127.0.0.1")
    if cfg.environment == "production" and effective_workers != 1:
        raise RuntimeError("Production server must use exactly one worker")
    if effective_port < 1 or effective_port > 65535:
        raise RuntimeError("Server port must be between 1 and 65535")
    uvicorn.run(
        "app.main:app",
        host=effective_host,
        port=effective_port,
        workers=effective_workers,
        log_level="info" if cfg.debug else "warning",
        access_log=cfg.debug,
        loop="uvloop",
        http="httptools",
    )


def cli() -> None:
    """Console entry point installed as both ``zc`` and ``zcoder``."""
    cfg = get_config()
    parser = argparse.ArgumentParser(description="Run the zcoder API service")
    parser.add_argument("--host", default=cfg.api_host)
    parser.add_argument("--port", type=int, default=cfg.api_port)
    parser.add_argument("--workers", type=int, default=cfg.api_workers)
    args = parser.parse_args()
    run_server(host=args.host, port=args.port, workers=args.workers)


if __name__ == "__main__":
    cli()
