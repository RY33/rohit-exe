import hashlib
import hmac
import logging
import time
import uuid
from typing import Literal, TypedDict

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.config import (
    EVENT_TOKEN_LIFETIME_SECONDS,
    LOG_AI_RESPONSE_TEXT,
    LOG_TRANSCRIPT_TEXT,
    get_event_signing_key,
)
from app.logging_config import log_event
from app.services.openai_service import (
    LiveSessionError,
    create_live_session,
)

router = APIRouter()

_EVENTS: dict[str, tuple[str, str]] = {
    "voice.button.clicked": ("VOICE", "Speak button clicked"),
    "voice.session.creation.started": ("VOICE", "Session creation started"),
    "voice.session.creation.completed": ("VOICE", "Session creation completed"),
    "session.connected": ("WEBRTC", "Connection established"),
    "session.disconnected": ("SESSION", "Session disconnected"),
    "microphone.permission.granted": ("VOICE", "Microphone permission granted"),
    "microphone.connected": ("AUDIO", "Microphone audio connected"),
    "microphone.disconnected": ("AUDIO", "Microphone audio disconnected"),
    "webrtc.peer.created": ("WEBRTC", "RTCPeerConnection created"),
    "webrtc.connection.state": ("WEBRTC", "Peer connection state changed"),
    "webrtc.ice.state": ("WEBRTC", "ICE connection state changed"),
    "webrtc.data_channel.opened": ("WEBRTC", "GPT-Live data channel opened"),
    "live.session.created": ("LIVE", "GPT-Live session created"),
    "live.session.started": ("LIVE", "GPT-Live session started"),
    "live.session.closed": ("LIVE", "GPT-Live session closed"),
    "live.instructions.sent": ("LIVE", "Opening instruction sent"),
    "live.instructions.acknowledged": ("LIVE", "Opening instruction acknowledged"),
    "live.transcript.delta": ("LIVE", "GPT-Live transcript fragment received"),
    "audio.remote_track.received": ("AUDIO", "Remote audio track received"),
    "audio.element.attached": ("AUDIO", "Remote stream attached to audio element"),
    "audio.element.play_resolved": ("AUDIO", "Remote audio play() promise resolved"),
    "audio.element.playing": ("AUDIO", "Remote audio element playing"),
    "audio.element.play_error": ("ERROR", "Remote audio element playback failed"),
    "audio.track.muted": ("AUDIO", "Remote audio track muted"),
    "audio.track.unmuted": ("AUDIO", "Remote audio track unmuted"),
    "audio.playback.started": ("AUDIO", "Actual remote audio playback started"),
    "initialization.music.stopped": ("AUDIO", "Initialization music stopped"),
    "ui.cat.shown": ("UI", "Initialization cat shown"),
    "ui.cat.hidden": ("UI", "Initialization cat hidden"),
    "ui.initialization.changed": ("UI", "Initialization status changed"),
    "speech.detected": ("TRANSCRIPTION", "User speech detected"),
    "transcription.started": ("TRANSCRIPTION", "Transcription started"),
    "transcription.completed": ("TRANSCRIPTION", "Final text"),
    "transcription.failed": ("TRANSCRIPTION", "Transcription failed"),
    "ai.response.started": ("AI", "Response generation started"),
    "ai.response.text": ("AI", "Generated"),
    "ai.audio.generation_started": ("AUDIO", "AI audio generation started"),
    "ai.audio.playback_started": ("AUDIO", "AI audio playback started"),
    "ai.response.completed": ("AI", "AI speech completed"),
    "ai.response.interrupted": ("AI", "AI response interrupted"),
    "audio.input": ("AUDIO", "Incoming audio stream active"),
    "audio.output": ("AUDIO", "Outgoing audio stream active"),
    "audio.connection.failed": ("AUDIO", "Audio connection failed"),
    "audio.reconnected": ("WEBRTC", "Audio connection re-established"),
    "api.failure": ("ERROR", "API request failed"),
    "webrtc.failure": ("ERROR", "WebRTC connection failed"),
    "live.error": ("ERROR", "GPT-Live connection error"),
    "audio.playback.failure": ("ERROR", "Audio playback failed"),
    "unexpected.exception": ("ERROR", "Unexpected client exception"),
    "latency.response": ("LATENCY", "Response generation duration"),
}


class LiveSessionResponse(TypedDict):
    success: Literal[True]
    session_id: str
    sdp: str
    event_token: str
    event_expires_at: int


class LiveSessionRequest(BaseModel):
    sdp: str = Field(min_length=1, max_length=64_000)


class LiveEventPayload(BaseModel):
    session_id: str = Field(min_length=1, max_length=64)
    event_expires_at: int
    event: str = Field(min_length=1, max_length=64)
    text: str | None = Field(default=None, max_length=2000)
    duration_ms: float | None = Field(default=None, ge=0, le=3_600_000)


def create_event_token(session_id: str, expires_at: int) -> str:
    payload = f"{session_id}:{expires_at}".encode("utf-8")
    return hmac.new(
        get_event_signing_key(),
        payload,
        hashlib.sha256,
    ).hexdigest()


def _safe_content(value: str) -> str:
    return " ".join(value.split())[:2000]


def log_frontend_event(payload: LiveEventPayload) -> None:
    category, label = _EVENTS[payload.event]
    level = (
        logging.ERROR
        if category == "ERROR"
        else logging.WARNING
        if payload.event == "transcription.failed"
        else logging.INFO
    )
    message = label
    if payload.event == "transcription.completed":
        if LOG_TRANSCRIPT_TEXT and payload.text:
            message = f'{label}: "{_safe_content(payload.text)}"'
        else:
            message = "Transcription completed (text redacted)"
    elif payload.event == "ai.response.text":
        if LOG_AI_RESPONSE_TEXT and payload.text:
            message = f'{label}: "{_safe_content(payload.text)}"'
        else:
            message = "AI response generated (text redacted)"
    if payload.duration_ms is not None:
        message = f"{message} ({payload.duration_ms:.1f} ms)"
    log_event(category, payload.session_id, message, level)


@router.post("/session", response_model=LiveSessionResponse)
async def create_session(request: LiveSessionRequest) -> LiveSessionResponse:
    request_id = str(uuid.uuid4())
    log_event("SESSION", request_id, "GPT-Live session requested")
    try:
        session_data = await create_live_session(request.sdp)
        event_expires_at = int(time.time()) + EVENT_TOKEN_LIFETIME_SECONDS
        event_token = create_event_token(session_data["session_id"], event_expires_at)
        log_event("SESSION", session_data["session_id"], "GPT-Live session created")
        return {
            "success": True,
            "session_id": session_data["session_id"],
            "sdp": session_data["sdp"],
            "event_token": event_token,
            "event_expires_at": event_expires_at,
        }
    except LiveSessionError as error:
        log_event(
            "ERROR",
            request_id,
            f"GPT-Live session creation failed (HTTP {error.status_code})",
            logging.WARNING,
        )
        raise HTTPException(
            status_code=error.status_code,
            detail=str(error),
        ) from error
    except Exception as error:
        log_event(
            "ERROR",
            request_id,
            f"Unexpected session creation failure: {type(error).__name__}",
            logging.ERROR,
        )
        raise HTTPException(
            status_code=500,
            detail="Could not create a voice session.",
        ) from error


@router.post("/events", status_code=202)
async def receive_live_diagnostic_event(
    event: LiveEventPayload,
    authorization: str | None = Header(default=None),
) -> dict[str, bool]:
    if event.event not in _EVENTS:
        raise HTTPException(status_code=422, detail="Unsupported event.")
    if event.event_expires_at <= int(time.time()):
        raise HTTPException(status_code=401, detail="Event credential expired.")
    try:
        expected_token = create_event_token(event.session_id, event.event_expires_at)
    except ValueError as error:
        log_event(
            "ERROR",
            event.session_id,
            "Event credential verification is unavailable",
            logging.ERROR,
        )
        raise HTTPException(
            status_code=401,
            detail="Invalid event credential.",
        ) from error
    supplied_token = (
        authorization.removeprefix("Bearer ").strip()
        if authorization
        else ""
    )
    if not hmac.compare_digest(supplied_token, expected_token):
        raise HTTPException(status_code=401, detail="Invalid event credential.")

    log_frontend_event(event)
    return {"accepted": True}
