import logging
import time
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .core.config import settings
from .core.logging import configure_logging
from .core.observability import request_metrics

configure_logging(settings.log_level)

from .api.routes import router

app = FastAPI(title=settings.app_name, version=settings.app_version, description="Versioned backend contract for the hybrid Kavach EW Command application.")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.include_router(router)

logger = logging.getLogger("kavach.http")


@app.middleware("http")
async def record_request_metrics(request: Request, call_next):
    started = time.perf_counter()
    route = request.scope.get("route")
    route_name = getattr(route, "path", request.url.path)
    try:
        response = await call_next(request)
    except Exception:
        elapsed = time.perf_counter() - started
        request_metrics.observe(request.method, route_name, 500, elapsed)
        logger.exception("http_request_failed", extra={"request_fields": {"method": request.method, "route": route_name, "status": 500, "duration_seconds": round(elapsed, 6)}})
        raise
    elapsed = time.perf_counter() - started
    request_metrics.observe(request.method, route_name, response.status_code, elapsed)
    logger.info("http_request", extra={"request_fields": {"method": request.method, "route": route_name, "status": response.status_code, "duration_seconds": round(elapsed, 6)}})
    return response
