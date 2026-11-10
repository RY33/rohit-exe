
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.requests import Request
from fastapi.responses import JSONResponse

from app.config import FRONTEND_ORIGINS, OPENAI_API_KEY
from app.logging_config import configure_logging, log_event
from app.routers.contact import router as contact_router
from app.routers.realtime import router as realtime_router

configure_logging()

app = FastAPI(
    title="Rohit.exe Backend",
    description="Backend for Rohit's AI portfolio",
    version="1.0.0",
)

# Temporary endpoint to verify OpenAI API key configuration
@app.get("/debug/config")
async def debug_config():
    return {
        "openai_key_configured": bool(OPENAI_API_KEY),
    }


app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(
    realtime_router,
    prefix="/api/realtime",
    tags=["Realtime"],
)

app.include_router(
    contact_router,
    prefix="/api/contact",
    tags=["Contact"],
)


@app.exception_handler(Exception)
async def handle_unexpected_exception(
    request: Request,
    error: Exception,
) -> JSONResponse:
    correlation_id = request.headers.get("x-correlation-id", "-")
    log_event(
    "ERROR",
    correlation_id=correlation_id,
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


@app.get("/")
async def home():
    return {"message": "Rohit.exe backend is running!"}


@app.get("/health")
async def health():
    return {"status": "healthy"}
