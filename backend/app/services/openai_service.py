import logging
from typing import Any, TypedDict

import httpx

from app.config import (
    LIVE_MODEL,
    OPENAI_LIVE_URL,
    OPENAI_REQUEST_TIMEOUT_SECONDS,
    get_openai_api_key,
)
from app.logging_config import log_event
from app.prompts.rohit_prompt import ROHIT_SYSTEM_PROMPT


class LiveSessionConnection(TypedDict):
    session_id: str
    sdp: str


class LiveSessionError(RuntimeError):
    """Raised when OpenAI cannot create a GPT-Live WebRTC session."""

    def __init__(
        self,
        message: str,
        status_code: int = 502,
        category: str = "openai_failure",
    ):
        super().__init__(message)
        self.status_code = status_code
        self.category = category


async def create_live_session(
    sdp_offer: str,
    request_id: str = "-",
) -> LiveSessionConnection:
    try:
        api_key = get_openai_api_key()
    except ValueError as error:
        log_event("SESSION", request_id, "OPENAI_API_KEY is not configured", logging.ERROR)
        raise LiveSessionError(
            str(error),
            status_code=503,
            category="configuration",
        ) from error

    session_request = {
        "session": {
            "model": LIVE_MODEL,
            "instructions": ROHIT_SYSTEM_PROMPT,
            "audio": {"output": {"voice": "marin"}},
            "client": {
                "data_channel": {
                    "allowed_client_events": [
                        "session.close",
                        "session.instructions.append",
                    ],
                },
            },
        },
        "transport": {"type": "webrtc", "sdp": sdp_offer},
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(
            timeout=OPENAI_REQUEST_TIMEOUT_SECONDS
        ) as client:
            response = await client.post(
                OPENAI_LIVE_URL,
                headers=headers,
                json=session_request,
            )
    except httpx.TimeoutException as error:
        log_event("OPENAI", request_id, "GPT-Live request timed out", logging.WARNING)
        raise LiveSessionError(
            "The OpenAI GPT-Live API request timed out.",
            category="timeout",
        ) from error
    except httpx.RequestError as error:
        log_event(
            "OPENAI",
            request_id,
            f"GPT-Live request failed error={type(error).__name__}",
            logging.WARNING,
        )
        raise LiveSessionError(
            "Could not reach the OpenAI GPT-Live API.",
            category="network",
        ) from error

    log_event(
        "OPENAI",
        request_id,
        f"GPT-Live API responded http_status={response.status_code}",
        logging.INFO if response.is_success else logging.WARNING,
    )
    if not response.is_success:
        message = f"OpenAI GPT-Live API returned HTTP {response.status_code}"
        try:
            error_data: Any = response.json()
        except ValueError:
            error_data = None

        if isinstance(error_data, dict):
            api_error = error_data.get("error")
            if isinstance(api_error, dict) and isinstance(api_error.get("message"), str):
                message = f"{message}: {api_error['message']}"

        raise LiveSessionError(message, category="upstream_http")

    try:
        data: Any = response.json()
    except ValueError as error:
        raise LiveSessionError(
            "OpenAI GPT-Live API returned an invalid response.",
            category="invalid_upstream_response",
        ) from error

    session = data.get("session") if isinstance(data, dict) else None
    transport = data.get("transport") if isinstance(data, dict) else None
    if (
        not isinstance(session, dict)
        or not isinstance(session.get("id"), str)
        or not session["id"]
        or not isinstance(transport, dict)
        or not isinstance(transport.get("sdp"), str)
        or not transport["sdp"]
    ):
        raise LiveSessionError(
            "OpenAI GPT-Live API response is missing the session ID or SDP answer.",
            category="invalid_upstream_response",
        )

    return {
        "session_id": session["id"],
        "sdp": transport["sdp"],
    }
