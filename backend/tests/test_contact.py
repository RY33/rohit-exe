import json
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient

from app.main import app
from app.routers import contact as contact_router


class ContactRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        log_event_patcher = patch("app.services.email_service.log_event")
        self.email_log = log_event_patcher.start()
        self.addCleanup(log_event_patcher.stop)
        contact_router._contact_requests.clear()

    def post_message(self, **overrides):
        body = {
            "name": "Alex Morgan",
            "email": "alex@company.com",
            "company": "Acme",
            "message": "I'd like to discuss an AI engineering opportunity.",
        }
        body.update(overrides)
        return self.client.post("/api/contact", json=body)

    def test_sends_to_configured_inbox_with_recruiter_as_reply_to(self) -> None:
        observed: dict[str, object] = {}
        original_async_client = httpx.AsyncClient

        def resend_response(request: httpx.Request) -> httpx.Response:
            observed["authorization"] = request.headers["authorization"]
            observed["payload"] = json.loads(request.content)
            return httpx.Response(200, json={"id": "test-email-id"})

        def create_mock_client(*args, **kwargs):
            kwargs["transport"] = httpx.MockTransport(resend_response)
            return original_async_client(*args, **kwargs)

        with (
            patch("app.config.RESEND_API_KEY", "test-resend-key"),
            patch("app.config.CONTACT_EMAIL", "  rohit@example.com  "),
            patch(
                "app.config.RESEND_FROM_EMAIL",
                " onboarding@resend.dev ",
            ),
            patch(
                "app.services.email_service.httpx.AsyncClient",
                side_effect=create_mock_client,
            ),
        ):
            response = self.post_message()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"success": True})
        self.assertEqual(observed["authorization"], "Bearer test-resend-key")
        log_messages = "\n".join(
            call.kwargs["message"] for call in self.email_log.call_args_list
        )
        self.assertIn("from='onboarding@resend.dev'", log_messages)
        self.assertIn("to='rohit@example.com'", log_messages)
        self.assertIn("reply_to='alex@company.com'", log_messages)
        self.assertIn("CONTACT_EMAIL_empty=False", log_messages)
        payload = observed["payload"]
        self.assertIsInstance(payload, dict)
        self.assertEqual(payload["to"], ["rohit@example.com"])
        self.assertEqual(payload["reply_to"], "alex@company.com")
        self.assertEqual(payload["from"], "onboarding@resend.dev")
        self.assertEqual(payload["subject"], "New recruiter message via Rohit.exe")
        self.assertIn("Name: Alex Morgan", payload["text"])
        self.assertIn("Company: Acme", payload["text"])
        self.assertIn("AI engineering opportunity", payload["text"])

    def test_rejects_invalid_email(self) -> None:
        response = self.post_message(email="not-an-email")

        self.assertEqual(response.status_code, 422)

    def test_rejects_missing_required_fields(self) -> None:
        response = self.client.post(
            "/api/contact",
            json={"name": "Alex", "email": "alex@company.com"},
        )

        self.assertEqual(response.status_code, 422)

    def test_rejects_blank_message(self) -> None:
        response = self.post_message(message="   ")

        self.assertEqual(response.status_code, 422)

    def test_invalid_resend_key_returns_specific_safe_error(self) -> None:
        original_async_client = httpx.AsyncClient

        def resend_failure(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                401,
                json={"message": "private provider failure detail"},
            )

        def create_mock_client(*args, **kwargs):
            kwargs["transport"] = httpx.MockTransport(resend_failure)
            return original_async_client(*args, **kwargs)

        with (
            patch("app.config.RESEND_API_KEY", "test-resend-key"),
            patch("app.config.CONTACT_EMAIL", "rohit@example.com"),
            patch(
                "app.config.RESEND_FROM_EMAIL",
                "onboarding@resend.dev",
            ),
            patch(
                "app.services.email_service.httpx.AsyncClient",
                side_effect=create_mock_client,
            ),
        ):
            response = self.post_message()

        self.assertEqual(response.status_code, 502)
        self.assertEqual(
            response.json(),
            {
                "detail": (
                    "Resend rejected the API key. Check RESEND_API_KEY in "
                    "backend environment variables."
                )
            },
        )
        self.assertNotIn("private provider failure detail", response.text)

    def test_testing_sender_restriction_gives_account_matching_guidance(self) -> None:
        original_async_client = httpx.AsyncClient

        def resend_failure(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                403,
                json={
                    "message": (
                        "You can only send testing emails to your own email "
                        "address (private@example.com)."
                    )
                },
            )

        def create_mock_client(*args, **kwargs):
            kwargs["transport"] = httpx.MockTransport(resend_failure)
            return original_async_client(*args, **kwargs)

        with (
            patch("app.config.RESEND_API_KEY", "test-resend-key"),
            patch("app.config.CONTACT_EMAIL", "rohit@example.com"),
            patch(
                "app.config.RESEND_FROM_EMAIL",
                "onboarding@resend.dev",
            ),
            patch(
                "app.services.email_service.httpx.AsyncClient",
                side_effect=create_mock_client,
            ),
        ):
            response = self.post_message()

        self.assertEqual(response.status_code, 502)
        self.assertIn("verified account email", response.text)
        self.assertIn("same Resend account as RESEND_API_KEY", response.text)
        self.assertNotIn("private@example.com", response.text)

    def test_resend_failure_logs_redacted_provider_response(self) -> None:
        original_async_client = httpx.AsyncClient

        def resend_failure(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                403,
                json={
                    "name": "validation_error",
                    "message": "Denied for private@example.com",
                },
            )

        def create_mock_client(*args, **kwargs):
            kwargs["transport"] = httpx.MockTransport(resend_failure)
            return original_async_client(*args, **kwargs)

        with (
            patch("app.config.RESEND_API_KEY", "re_test_secret"),
            patch("app.config.CONTACT_EMAIL", "rohit@example.com"),
            patch(
                "app.config.RESEND_FROM_EMAIL",
                "onboarding@resend.dev",
            ),
            patch(
                "app.services.email_service.httpx.AsyncClient",
                side_effect=create_mock_client,
            ),
        ):
            self.email_log.reset_mock()
            response = self.post_message()

        self.assertEqual(response.status_code, 502)
        log_messages = "\n".join(
            call.kwargs["message"] for call in self.email_log.call_args_list
        )
        self.assertIn("HTTP 403", log_messages)
        self.assertIn('"name":"validation_error"', log_messages)
        self.assertIn(
            '"message":"Denied for [REDACTED_EMAIL]"',
            log_messages,
        )
        self.assertNotIn("private@example.com", log_messages)
        self.assertNotIn("re_test_secret", log_messages)

    def test_resend_server_error_returns_retry_guidance(self) -> None:
        original_async_client = httpx.AsyncClient

        def resend_failure(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                500,
                json={"message": "provider internal stack trace"},
            )

        def create_mock_client(*args, **kwargs):
            kwargs["transport"] = httpx.MockTransport(resend_failure)
            return original_async_client(*args, **kwargs)

        with (
            patch("app.config.RESEND_API_KEY", "test-resend-key"),
            patch("app.config.CONTACT_EMAIL", "rohit@example.com"),
            patch(
                "app.config.RESEND_FROM_EMAIL",
                "verified@example.com",
            ),
            patch(
                "app.services.email_service.httpx.AsyncClient",
                side_effect=create_mock_client,
            ),
        ):
            response = self.post_message()

        self.assertEqual(response.status_code, 502)
        self.assertIn("temporarily unavailable", response.text)
        self.assertNotIn("provider internal stack trace", response.text)

    def test_rate_limits_repeated_contact_requests(self) -> None:
        with (
            patch.object(contact_router, "RATE_LIMIT_REQUESTS", 2),
            patch(
                "app.routers.contact.send_contact_email",
                new_callable=AsyncMock,
            ),
        ):
            responses = [self.post_message() for _ in range(3)]

        self.assertEqual([response.status_code for response in responses], [200, 200, 429])
        self.assertIn("Retry-After", responses[-1].headers)

    def test_honeypot_submission_is_accepted_without_sending(self) -> None:
        with patch(
            "app.routers.contact.send_contact_email",
            new_callable=AsyncMock,
        ) as send_email:
            response = self.post_message(website="spam")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"success": True})
        send_email.assert_not_awaited()

    def test_missing_email_configuration_returns_safe_error(self) -> None:
        with (
            patch("app.config.RESEND_API_KEY", None),
            patch("app.config.CONTACT_EMAIL", None),
            patch("app.config.RESEND_FROM_EMAIL", None),
        ):
            response = self.post_message()

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.json(),
            {
                "detail": (
                    "Contact messaging is not configured. Set RESEND_API_KEY "
                    "and CONTACT_EMAIL in backend/.env, then restart the "
                    "backend. backend/.env.example is only a template and is "
                    "not loaded."
                )
            },
        )
