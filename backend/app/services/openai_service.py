from typing import Any, TypedDict

import httpx

from app.config import (
    OPENAI_REALTIME_URL,
    OPENAI_REQUEST_TIMEOUT_SECONDS,
    REALTIME_MODEL,
    get_openai_api_key,
)
from app.prompts.rohit_prompt import ROHIT_SYSTEM_PROMPT


class RealtimeSessionCredentials(TypedDict):
    client_secret: str
    expires_at: int


class RealtimeSessionError(RuntimeError):
    """Raised when OpenAI cannot create a temporary Realtime credential."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


async def create_realtime_session() -> RealtimeSessionCredentials:
    try:
        api_key = get_openai_api_key()
    except ValueError as error:
        raise RealtimeSessionError(str(error), status_code=503) from error

    session_config = {
        "session": {
            "type": "realtime",
            "model": REALTIME_MODEL,
            "instructions": ROHIT_SYSTEM_PROMPT,
            "audio": {
                "input": {
                    "noise_reduction": {"type": "near_field"},
                    "turn_detection": {"type": "server_vad"},
                },
                "output": {"voice": "marin"},
            },
        }
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
                OPENAI_REALTIME_URL,
                headers=headers,
                json=session_config,
            )
    except httpx.TimeoutException as error:
        raise RealtimeSessionError(
            "The OpenAI Realtime API request timed out."
        ) from error
    except httpx.RequestError as error:
        raise RealtimeSessionError(
            "Could not reach the OpenAI Realtime API."
        ) from error

    if not response.is_success:
        message = f"OpenAI Realtime API returned HTTP {response.status_code}"
        try:
            error_data: Any = response.json()
        except ValueError:
            error_data = None

        if isinstance(error_data, dict):
            api_error = error_data.get("error")
            if isinstance(api_error, dict) and isinstance(api_error.get("message"), str):
                message = f"{message}: {api_error['message']}"

        raise RealtimeSessionError(message)

    try:
        data: Any = response.json()
    except ValueError as error:
        raise RealtimeSessionError(
            "OpenAI Realtime API returned an invalid response."
        ) from error

    if (
        not isinstance(data, dict)
        or not isinstance(data.get("value"), str)
        or not data["value"]
        or type(data.get("expires_at")) is not int
    ):
        raise RealtimeSessionError(
            "OpenAI Realtime API response is missing the temporary credential or expiry."
        )

    return {
        "client_secret": data["value"],
        "expires_at": data["expires_at"],
    }
