"""FastAPI application and supported console entry point for zcoder."""

import argparse
import logging
import time
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Optional

import uvicorn
from fastapi import FastAPI, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from .api.v1.routes import router as wire_router
from .core.cache import get_cache, init_cache, shutdown_cache
from .core.config import get_config
from .core.http_client import init_http_client, shutdown_http_client
from .services.upload_manager import init_upload_manager

logger = logging.getLogger(__name__)


def _set_component_state(
    app: FastAPI, name: str, ready: bool, error: str | None = None
) -> None:
    app.state.components[name] = {"ready": ready, "error": error}


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Initialize optional integrations and expose their state to readiness."""
    config = get_config()
    app.state.components = {}

    logger.info(
        "Starting %s v%s in %s", config.app_name, config.version, config.environment
    )

    if config.redis_enabled:
        try:
            await init_cache()
            _set_component_state(app, "redis", True)
        except Exception as exc:  # startup state is reported by /ready
            logger.exception("Cache initialization failed")
            _set_component_state(app, "redis", False, str(exc))
    else:
        _set_component_state(app, "redis", True, "disabled")

    try:
        await init_http_client()
        _set_component_state(app, "http_client", True)
    except Exception as exc:
        logger.exception("HTTP client initialization failed")
        _set_component_state(app, "http_client", False, str(exc))

    try:
        await init_upload_manager()
        _set_component_state(app, "upload_manager", True)
    except Exception as exc:
        logger.exception("Upload manager initialization failed")
        _set_component_state(app, "upload_manager", False, str(exc))

    if config.protobuf_enabled:
        try:
            from .grpc.wire_servicer import create_grpc_server
            from .services.upload_manager import get_upload_manager

            grpc_server = await create_grpc_server(
                host=config.api_host,
                port=config.api_port + 1,
                upload_manager=get_upload_manager(),
                delta_service=None,
            )
            await grpc_server.start()
            app.state.grpc_server = grpc_server
            _set_component_state(app, "grpc", True)
        except Exception as exc:
            logger.exception("gRPC server initialization failed")
            _set_component_state(app, "grpc", False, str(exc))
    else:
        _set_component_state(app, "grpc", True, "disabled")

    yield

    if hasattr(app.state, "grpc_server"):
        await app.state.grpc_server.stop(grace=5.0)
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

# Wildcard origins and credentialed requests are mutually unsafe. Development
# permits any origin without credentials; production enables no cross-origin
# callers unless an explicit policy is added by the deployment layer.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if config.debug else [],
    allow_credentials=False,
    allow_methods=["*"] if config.debug else [],
    allow_headers=["*"] if config.debug else [],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.middleware("http")
async def add_timing_header(request: Request, call_next) -> Response:
    start_time = time.perf_counter()
    response = await call_next(request)
    process_time = (time.perf_counter() - start_time) * 1000
    response.headers["X-Process-Time"] = f"{process_time:.2f}ms"
    return response


app.include_router(wire_router)


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "name": config.app_name,
        "version": config.version,
        "description": "zcoder API service",
        "docs": "/docs" if config.debug else "Disabled in production",
        "health": "/v1/wire/health/live",
        "readiness": "/ready",
    }


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
async def cache_health() -> dict:
    """Expose cache state without leaking connection credentials."""
    return await get_cache().health_check()


def run_server(
    host: Optional[str] = None,
    port: Optional[int] = None,
    workers: Optional[int] = None,
) -> None:
    cfg = get_config()
    uvicorn.run(
        "app.main:app",
        host=host or cfg.api_host,
        port=port or cfg.api_port,
        workers=workers or cfg.api_workers,
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
