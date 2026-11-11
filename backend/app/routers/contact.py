import time
from collections import deque
from threading import Lock

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field, field_validator

from app.services.email_service import (
    EmailConfigurationError,
    EmailDeliveryError,
    send_contact_email,
)

router = APIRouter()
//rate limit
RATE_LIMIT_REQUESTS = 5
RATE_LIMIT_WINDOW_SECONDS = 10 * 60
MAX_TRACKED_ADDRESSES = 2048
_contact_requests: dict[str, deque[float]] = {}
_rate_limit_lock = Lock()


class ContactRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr = Field(max_length=254)
    company: str | None = Field(default=None, max_length=120)
    message: str = Field(min_length=1, max_length=3000)
    website: str | None = Field(default=None, max_length=200)

    @field_validator("name", "message", mode="before")
    @classmethod
    def strip_required_text(cls, value: object) -> object:
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                raise ValueError("This field must not be empty.")
            return stripped
        return value

    @field_validator("company", "website", mode="before")
    @classmethod
    def strip_optional_text(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip() or None
        return value


def _check_rate_limit(address: str) -> None:
    now = time.monotonic()
    cutoff = now - RATE_LIMIT_WINDOW_SECONDS

    with _rate_limit_lock:
        for tracked_address, timestamps in list(_contact_requests.items()):
            while timestamps and timestamps[0] <= cutoff:
                timestamps.popleft()
            if not timestamps:
                del _contact_requests[tracked_address]

        requests = _contact_requests.get(address)
        if requests is None:
            if len(_contact_requests) >= MAX_TRACKED_ADDRESSES:
                raise HTTPException(
                    status_code=429,
                    detail="Too many contact requests. Please try again later.",
                    headers={"Retry-After": str(RATE_LIMIT_WINDOW_SECONDS)},
                )
            requests = deque()
            _contact_requests[address] = requests

        if len(requests) >= RATE_LIMIT_REQUESTS:
            raise HTTPException(
                status_code=429,
                detail="Too many contact requests. Please try again later.",
                headers={"Retry-After": str(RATE_LIMIT_WINDOW_SECONDS)},
            )
        requests.append(now)


@router.post("", response_model=dict[str, bool])
async def submit_contact_message(
    contact: ContactRequest,
    request: Request,
    response: Response,
) -> dict[str, bool]:
    address = request.client.host if request.client else "unknown"
    _check_rate_limit(address)
    response.headers["Cache-Control"] = "no-store"

    if contact.website:
        return {"success": True}

    try:
        await send_contact_email(contact)
    except EmailConfigurationError as error:
        raise HTTPException(
            status_code=503,
            detail=(
                "Contact messaging is not configured. Set RESEND_API_KEY and "
                "CONTACT_EMAIL in backend/.env, then restart the backend. "
                "backend/.env.example is only a template and is not loaded."
            ),
        ) from error
    except EmailDeliveryError as error:
        raise HTTPException(
            status_code=502,
            detail=error.public_message,
        ) from error

    return {"success": True}
