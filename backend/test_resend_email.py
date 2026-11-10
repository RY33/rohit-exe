import asyncio

from app import config
from app.logging_config import configure_logging
from app.routers.contact import ContactRequest
from app.services.email_service import send_contact_email


async def main() -> None:
    destination = (config.CONTACT_EMAIL or "").strip()
    if not destination:
        raise RuntimeError("CONTACT_EMAIL is missing from backend/.env.")

    await send_contact_email(
        ContactRequest(
            name="Resend configuration test",
            email=destination,
            message="This is a one-time test of the backend Resend configuration.",
        )
    )
    print(f"Test email sent to {destination}")


if __name__ == "__main__":
    configure_logging()
    asyncio.run(main())
