from __future__ import annotations

import logging
import re
from typing import TYPE_CHECKING

from email_validator import EmailNotValidError, validate_email
import httpx

from app import config
from app.logging_config import log_event

if TYPE_CHECKING:
    from app.routers.contact import ContactRequest

RESEND_EMAILS_URL = "https://api.resend.com/emails"
RESEND_TIMEOUT_SECONDS = 15.0
_EMAIL_PATTERN = re.compile(
    r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b",
    re.IGNORECASE,
)
_BEARER_PATTERN = re.compile(r"(?i)(\bbearer\s+)[^\s\"']+")
_RESEND_KEY_PATTERN = re.compile(r"\bre_[A-Za-z0-9_-]+\b")


class EmailConfigurationError(RuntimeError):
    pass


class EmailDeliveryError(RuntimeError):
    def __init__(self, public_message: str) -> None:
        super().__init__(public_message)
        self.public_message = public_message


def _contact_email_settings() -> tuple[str, str, str]:
    api_key = (config.RESEND_API_KEY or "").strip()
    destination = (config.CONTACT_EMAIL or "").strip()
    sender = (config.RESEND_FROM_EMAIL or "").strip()
    if not api_key or not destination or not sender:
        raise EmailConfigurationError("Contact email settings are incomplete.")
    try:
        validate_email(destination, check_deliverability=False)
    except EmailNotValidError as error:
        raise EmailConfigurationError(
            "CONTACT_EMAIL must contain one valid email address."
        ) from error
    return api_key, destination, sender


async def send_contact_email(contact: ContactRequest) -> None:
    configured_destination = (config.CONTACT_EMAIL or "").strip()
    configured_sender = (config.RESEND_FROM_EMAIL or "").strip()
    reply_to = str(contact.email)
    log_event(
        "EMAIL",
        "-",
        f"Resolved Resend contact addresses: from={configured_sender!r} "
        f"to={configured_destination!r} reply_to={reply_to!r} "
        f"CONTACT_EMAIL_empty={not bool(configured_destination)}",
    )
    api_key, destination, sender = _contact_email_settings()
    message_lines = [
        f"Name: {contact.name}",
        f"Email: {reply_to}",
    ]
    if contact.company:
        message_lines.append(f"Company: {contact.company}")
    message_lines.extend(("", "Message:", contact.message))

    payload = {
        "from": sender,
        "to": [destination],
        "reply_to": reply_to,
        "subject": "New recruiter message via Rohit.exe",
        "text": "\n".join(message_lines),
    }

    try:
        async with httpx.AsyncClient(timeout=RESEND_TIMEOUT_SECONDS) as client:
            response = await client.post(
                RESEND_EMAILS_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                json=payload,
            )
    except httpx.RequestError as error:
        raise EmailDeliveryError("Resend could not be reached.") from error

    if not response.is_success:
        log_event(
            "EMAIL",
            "-",
            f"Resend rejected a contact notification (HTTP {response.status_code}). "
            f"Response body: {_redact_resend_error_body(response.text, api_key)}",
            logging.WARNING,
        )
        raise EmailDeliveryError(_resend_failure_message(response, sender))


def _redact_resend_error_body(body: str, api_key: str) -> str:
    if api_key:
        body = body.replace(api_key, "[REDACTED]")
    body = _BEARER_PATTERN.sub(r"\1[REDACTED]", body)
    body = _RESEND_KEY_PATTERN.sub("[REDACTED]", body)
    return _EMAIL_PATTERN.sub("[REDACTED_EMAIL]", body)


def _resend_failure_message(response: httpx.Response, sender: str) -> str:
    provider_message = ""
    try:
        error_body = response.json()
    except ValueError:
        error_body = None

    if isinstance(error_body, dict):
        message = error_body.get("message")
        if isinstance(message, str):
            provider_message = message.lower()

    is_testing_sender = sender.strip().lower() == "onboarding@resend.dev"
    testing_recipient_restriction = any(
        phrase in provider_message
        for phrase in (
            "testing email",
            "own email address",
            "verify a domain",
            "only send",
        )
    )
    if is_testing_sender and (
        testing_recipient_restriction or response.status_code == 403
    ):
        return (
            "Resend rejected the testing-sender recipient. Confirm CONTACT_EMAIL "
            "is the verified account email for the same Resend account as "
            "RESEND_API_KEY. The onboarding sender cannot send to arbitrary "
            "recruiter addresses."
        )
    if response.status_code == 401:
        return (
            "Resend rejected the API key. Check RESEND_API_KEY in backend/.env, "
            "then restart the backend."
        )
    if response.status_code == 403:
        return (
            "Resend denied this request. Check the API key's permissions and "
            "that the sender is allowed for this Resend account."
        )
    if response.status_code == 429:
        return "Resend is rate-limiting email requests. Please wait and try again."
    if response.status_code >= 500:
        return "Resend is temporarily unavailable. Please try again later."
    if response.status_code in {400, 422}:
        return (
            "Resend rejected the sender or recipient settings. Check the "
            "RESEND_FROM_EMAIL and CONTACT_EMAIL values in backend/.env."
        )
    return (
        "Resend couldn't send this message. Check the backend email settings "
        "and try again."
    )
