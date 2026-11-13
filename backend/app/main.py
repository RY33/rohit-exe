
import logging
import os
import re
import time
import uuid

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.requests import Request
from fastapi.responses import JSONResponse

from app.config import FRONTEND_ORIGINS, OPENAI_API_KEY
from app.logging_config import configure_logging, log_event
from app.routers.contact import router as contact_router
from app.routers.live import (
    LiveSessionResponse,
    create_session,
    router as live_router,
)

configure_logging()

fastapi_app = FastAPI(
    title="Rohit.exe Backend",
    description="Backend for Rohit's AI portfolio",
    version="1.0.0",
)

# Temporary endpoint to verify OpenAI API key configuration
@fastapi_app.get("/debug/config")
async def debug_config():
    return {
        "openai_key_configured": bool(OPENAI_API_KEY),
    }

fastapi_app.include_router(live_router, prefix="/api/live", tags=["GPT-Live"])
fastapi_app.add_api_route(
    "/api/realtime/session",
    create_session,
    methods=["POST"],
    response_model=LiveSessionResponse,
    include_in_schema=False,
)

fastapi_app.include_router(
    contact_router,
    prefix="/api/contact",
    tags=["Contact"],
)


@fastapi_app.middleware("http")
async def log_request_diagnostics(request: Request, call_next):
    supplied_request_id = request.headers.get("x-request-id", "")
    request_id = (
        supplied_request_id
        if re.fullmatch(r"[a-fA-F0-9-]{36}", supplied_request_id)
        else str(uuid.uuid4())
    )
    request.state.request_id = request_id
    environment = os.getenv("VERCEL_ENV", "local")
    deployment = os.getenv("VERCEL_URL", "local")
    started_at = time.perf_counter()
    log_event(
        "HTTP",
        request_id,
        f"Request started method={request.method} path={request.url.path} "
        f"environment={environment} deployment={deployment}",
    )
    try:
        response = await call_next(request)
    except Exception as error:
        duration_ms = (time.perf_counter() - started_at) * 1000
        log_event(
            "HTTP",
            request_id,
            f"Request failed method={request.method} path={request.url.path} "
            f"error={type(error).__name__} duration_ms={duration_ms:.1f}",
            logging.ERROR,
        )
        raise

    duration_ms = (time.perf_counter() - started_at) * 1000
    response.headers["X-Request-ID"] = request_id
    log_event(
        "HTTP",
        request_id,
        f"Request completed method={request.method} path={request.url.path} "
        f"status={response.status_code} duration_ms={duration_ms:.1f}",
        logging.WARNING if response.status_code >= 400 else logging.INFO,
    )
    return response


@fastapi_app.exception_handler(Exception)
async def handle_unexpected_exception(
    request: Request,
    error: Exception,
) -> JSONResponse:
    request_id = getattr(request.state, "request_id", "-")
    log_event(
        "ERROR",
        request_id=request_id,
        message=(
            f"Unexpected {request.method} {request.url.path} failure: "
            f"{type(error).__name__}"
        ),
        level=logging.ERROR,
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "An unexpected server error occurred."},
    )


@fastapi_app.get("/")
async def home():
    return {"message": "Rohit.exe backend is running!"}


@fastapi_app.get("/health")
async def health():
    commit = os.getenv("VERCEL_GIT_COMMIT_SHA")
    return {
        "status": "healthy",
        "service": "rohit-exe-backend",
        "version": fastapi_app.version,
        "environment": os.getenv("VERCEL_ENV", "local"),
        "deployment": os.getenv("VERCEL_URL"),
        "commit": commit[:12] if commit else None,
    }


# Wrapping the full application also adds CORS headers to unhandled error responses.
app = CORSMiddleware(
    app=fastapi_app,
    allow_origins=FRONTEND_ORIGINS,
    allow_origin_regex=r"https://rohit-exe-.*-rohity33\.vercel\.app",
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)
