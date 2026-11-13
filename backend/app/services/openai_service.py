from typing import Any, TypedDict

import httpx

from app.config import (
    LIVE_MODEL,
    OPENAI_LIVE_URL,
    OPENAI_REQUEST_TIMEOUT_SECONDS,
    get_openai_api_key,
)
from app.prompts.rohit_prompt import ROHIT_SYSTEM_PROMPT


class LiveSessionConnection(TypedDict):
    session_id: str
    sdp: str


class LiveSessionError(RuntimeError):
    """Raised when OpenAI cannot create a GPT-Live WebRTC session."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


async def create_live_session(sdp_offer: str) -> LiveSessionConnection:
    try:
        api_key = get_openai_api_key()
    except ValueError as error:
        raise LiveSessionError(str(error), status_code=503) from error

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
        raise LiveSessionError(
            "The OpenAI GPT-Live API request timed out."
        ) from error
    except httpx.RequestError as error:
        raise LiveSessionError(
            "Could not reach the OpenAI GPT-Live API."
        ) from error

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

        raise LiveSessionError(message)

    try:
        data: Any = response.json()
    except ValueError as error:
        raise LiveSessionError(
            "OpenAI GPT-Live API returned an invalid response."
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
            "OpenAI GPT-Live API response is missing the session ID or SDP answer."
        )

    return {
        "session_id": session["id"],
        "sdp": transport["sdp"],
    }
