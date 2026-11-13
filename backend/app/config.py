import logging
import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIRECTORY / ".env")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
RESEND_API_KEY = os.getenv("RESEND_API_KEY")
CONTACT_EMAIL = os.getenv("CONTACT_EMAIL")
RESEND_FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL", "onboarding@resend.dev")
OPENAI_LIVE_URL = "https://api.openai.com/v1/live/sessions"
LIVE_MODEL = "gpt-live-1"
OPENAI_REQUEST_TIMEOUT_SECONDS = 30.0
EVENT_TOKEN_LIFETIME_SECONDS = 4 * 60 * 60
LOG_TRANSCRIPT_TEXT = os.getenv("LOG_TRANSCRIPT_TEXT", "false").lower() in {
    "1",
    "true",
    "yes",
}
LOG_AI_RESPONSE_TEXT = os.getenv("LOG_AI_RESPONSE_TEXT", "false").lower() in {
    "1",
    "true",
    "yes",
}
VOICE_LOG_LEVEL = logging._nameToLevel.get(
    os.getenv("VOICE_LOG_LEVEL", "INFO").upper(),
    logging.INFO,
)
_log_directory = Path(os.getenv("VOICE_LOG_DIRECTORY", "logs"))
VOICE_LOG_DIRECTORY = (
    _log_directory
    if _log_directory.is_absolute()
    else BACKEND_DIRECTORY / _log_directory
)
FRONTEND_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,"
        "http://localhost:3001,http://127.0.0.1:3001",
    ).split(",")
    if origin.strip()
]


def get_openai_api_key() -> str:
    if not OPENAI_API_KEY:
        raise ValueError("OPENAI_API_KEY is missing from backend/.env or the environment")
    return OPENAI_API_KEY


def get_event_signing_key() -> bytes:
    return get_openai_api_key().encode("utf-8")