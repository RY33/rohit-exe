import json
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from app.main import app
from app.prompts.rohit_prompt import ROHIT_SYSTEM_PROMPT
from app.routers.realtime import create_event_token


class RealtimeRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_system_prompt_contains_requested_opening_and_interview_guardrails(self) -> None:
        normalized_prompt = " ".join(ROHIT_SYSTEM_PROMPT.split())

        self.assertIn(
            "Hey! I'm Rohit.exe — Rohit's AI-powered digital portfolio. "
            "Think of me as the slightly more talkative version of his resume. "
            "I can walk you through the AI products he's built, the scale they "
            "operate at, and the impact they've made. What would you like to know?",
            normalized_prompt,
        )
        self.assertIn("Never exaggerate or invent achievements", normalized_prompt)
        self.assertIn(
            "Remember previously discussed projects and avoid repeating "
            "the same achievements",
            normalized_prompt,
        )

    def test_system_prompt_limits_contact_tool_to_opening_the_interface(self) -> None:
        normalized_prompt = " ".join(ROHIT_SYSTEM_PROMPT.split())

        self.assertIn("open_contact_form tool", normalized_prompt)
        self.assertIn("Never send a message, book a meeting", normalized_prompt)

    def test_system_prompt_only_introduces_the_assistant_once_per_conversation(self) -> None:
        normalized_prompt = " ".join(ROHIT_SYSTEM_PROMPT.split())

        self.assertIn(
            "Do not begin later answers by repeating your name",
            normalized_prompt,
        )
        self.assertIn(
            "Never repeat this introduction in later turns",
            normalized_prompt,
        )

    def mock_openai_request(self, handler, api_key: str | None = "test-api-key"):
        original_async_client = httpx.AsyncClient

        def create_mock_client(*args, **kwargs):
            kwargs["transport"] = httpx.MockTransport(handler)
            return original_async_client(*args, **kwargs)

        return (
            patch("app.config.OPENAI_API_KEY", api_key),
            patch(
                "app.services.openai_service.httpx.AsyncClient",
                side_effect=create_mock_client,
            ),
        )

    def test_health_is_available_without_an_api_key(self) -> None:
        with patch("app.config.OPENAI_API_KEY", None):
            response = self.client.get(
                "/health",
                headers={"Origin": "http://localhost:3000"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "healthy"})
        self.assertEqual(
            response.headers["access-control-allow-origin"],
            "http://localhost:3000",
        )

    def test_health_allows_alternate_local_frontend_port(self) -> None:
        response = self.client.get(
            "/health",
            headers={"Origin": "http://127.0.0.1:3001"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["access-control-allow-origin"],
            "http://127.0.0.1:3001",
        )

    def test_creates_temporary_client_secret(self) -> None:
        def openai_response(request: httpx.Request) -> httpx.Response:
            self.assertEqual(
                request.headers["authorization"],
                "Bearer test-api-key",
            )
            request_body = json.loads(request.content)
            self.assertEqual(request_body["session"]["model"], "gpt-realtime-2.1")
            self.assertEqual(
                request_body["session"]["instructions"],
                ROHIT_SYSTEM_PROMPT,
            )
            return httpx.Response(
                200,
                json={"value": "ek_test_secret", "expires_at": 1_900_000_000},
            )

        api_key_patch, client_patch = self.mock_openai_request(openai_response)
        with api_key_patch, client_patch:
            response = self.client.post("/api/realtime/session")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            set(response.json()),
            {
                "success",
                "client_secret",
                "expires_at",
                "instructions",
                "session_id",
                "event_token",
                "event_expires_at",
            },
        )
        self.assertEqual(response.json()["client_secret"], "ek_test_secret")
        self.assertEqual(response.json()["expires_at"], 1_900_000_000)
        self.assertEqual(response.json()["instructions"], ROHIT_SYSTEM_PROMPT)
        self.assertTrue(response.json()["session_id"])
        self.assertTrue(response.json()["event_token"])

    def test_missing_api_key_returns_service_unavailable(self) -> None:
        def unexpected_request(request: httpx.Request) -> httpx.Response:
            self.fail("OpenAI should not be called without an API key")

        api_key_patch, client_patch = self.mock_openai_request(
            unexpected_request,
            api_key=None,
        )
        with api_key_patch, client_patch:
            response = self.client.post("/api/realtime/session")

        self.assertEqual(response.status_code, 503)
        self.assertIn("OPENAI_API_KEY is missing", response.json()["detail"])

    def test_openai_api_failure_returns_gateway_error(self) -> None:
        def openai_error(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                401,
                json={"error": {"message": "Invalid API key"}},
            )

        api_key_patch, client_patch = self.mock_openai_request(openai_error)
        with api_key_patch, client_patch:
            response = self.client.post("/api/realtime/session")

        self.assertEqual(response.status_code, 502)
        self.assertIn("HTTP 401", response.json()["detail"])
        self.assertIn("Invalid API key", response.json()["detail"])

    def test_openai_timeout_returns_gateway_error(self) -> None:
        def timeout(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("request timed out")

        api_key_patch, client_patch = self.mock_openai_request(timeout)
        with api_key_patch, client_patch:
            response = self.client.post("/api/realtime/session")

        self.assertEqual(response.status_code, 502)
        self.assertIn("timed out", response.json()["detail"])

    def test_event_endpoint_rejects_invalid_credentials(self) -> None:
        with patch("app.config.OPENAI_API_KEY", "test-api-key"):
            response = self.client.post(
                "/api/realtime/events",
                headers={"Authorization": "Bearer invalid"},
                json={
                    "session_id": "session-one",
                    "event_expires_at": int(time.time()) + 60,
                    "event": "speech.detected",
                },
            )

        self.assertEqual(response.status_code, 401)

    def test_event_endpoint_rejects_expired_credentials(self) -> None:
        response = self.client.post(
            "/api/realtime/events",
            json={
                "session_id": "session-one",
                "event_expires_at": int(time.time()) - 1,
                "event": "speech.detected",
            },
        )

        self.assertEqual(response.status_code, 401)

    def test_concurrent_events_keep_their_session_ids(self) -> None:
        expiry = int(time.time()) + 60
        sessions = ("session-one", "session-two")
        observed: list[str] = []

        def capture_event(payload) -> None:
            observed.append(payload.session_id)

        def send_event(session_id: str):
            return self.client.post(
                "/api/realtime/events",
                headers={
                    "Authorization": (
                        f"Bearer {create_event_token(session_id, expiry)}"
                    )
                },
                json={
                    "session_id": session_id,
                    "event_expires_at": expiry,
                    "event": "speech.detected",
                },
            )

        with patch("app.config.OPENAI_API_KEY", "test-api-key"):
            with patch("app.routers.realtime.log_frontend_event", side_effect=capture_event):
                with ThreadPoolExecutor(max_workers=2) as executor:
                    responses = list(executor.map(send_event, sessions))

        self.assertEqual([response.status_code for response in responses], [202, 202])
        self.assertCountEqual(observed, sessions)

    def test_transcription_content_is_redacted_by_default(self) -> None:
        from app.routers.realtime import RealtimeEventPayload, log_frontend_event

        payload = RealtimeEventPayload(
            session_id="session-one",
            event_expires_at=int(time.time()) + 60,
            event="transcription.completed",
            text="A private phrase",
        )
        with patch("app.routers.realtime.log_event") as log:
            log_frontend_event(payload)

        self.assertIn("redacted", log.call_args.args[2])
        self.assertNotIn("A private phrase", log.call_args.args[2])

    def test_ai_response_content_can_be_enabled(self) -> None:
        from app.routers.realtime import RealtimeEventPayload, log_frontend_event

        payload = RealtimeEventPayload(
            session_id="session-one",
            event_expires_at=int(time.time()) + 60,
            event="ai.response.text",
            text="A generated answer",
        )
        with patch("app.routers.realtime.LOG_AI_RESPONSE_TEXT", True):
            with patch("app.routers.realtime.log_event") as log:
                log_frontend_event(payload)

        self.assertIn("A generated answer", log.call_args.args[2])


if __name__ == "__main__":
    unittest.main()
