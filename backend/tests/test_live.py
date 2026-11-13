import json
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from app.config import FRONTEND_ORIGINS
from app.main import app
from app.prompts.rohit_prompt import ROHIT_SYSTEM_PROMPT
from app.routers.live import create_event_token


class LiveApiTests(unittest.TestCase):
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

    def test_system_prompt_does_not_instruct_tool_use(self) -> None:
        normalized_prompt = " ".join(ROHIT_SYSTEM_PROMPT.split())

        self.assertIn("visible Contact Rohit button", normalized_prompt)
        self.assertNotIn("open_contact_form", normalized_prompt)

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
        self.assertEqual(response.json()["status"], "healthy")
        self.assertEqual(response.json()["service"], "rohit-exe-backend")
        self.assertEqual(response.json()["environment"], "local")
        self.assertEqual(
            response.headers["access-control-allow-origin"],
            "http://localhost:3000",
        )
        self.assertTrue(response.headers["x-request-id"])

    def test_health_allows_alternate_local_frontend_port(self) -> None:
        origin = "http://127.0.0.1:3001"
        if origin not in FRONTEND_ORIGINS:
            self.skipTest("Alternate local frontend origin is not configured.")

        response = self.client.get(
            "/health",
            headers={"Origin": origin},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["access-control-allow-origin"],
            origin,
        )

    def test_health_allows_vercel_preview_frontend(self) -> None:
        origin = "https://rohit-exe-preview-abc123-rohity33.vercel.app"
        response = self.client.get(
            "/health",
            headers={"Origin": origin},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["access-control-allow-origin"],
            origin,
        )

    def test_live_session_preflight_allows_production_frontend(self) -> None:
        origin = "https://rohity-exe.vercel.app"
        response = self.client.options(
            "/api/live/session",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type,x-request-id",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], origin)
        self.assertIn(
            "POST",
            response.headers["access-control-allow-methods"].split(", "),
        )
        allowed_headers = response.headers["access-control-allow-headers"].lower()
        self.assertIn("content-type", allowed_headers)
        self.assertIn("x-request-id", allowed_headers)

    def test_creates_live_webrtc_session(self) -> None:
        def openai_response(request: httpx.Request) -> httpx.Response:
            self.assertEqual(
                request.headers["authorization"],
                "Bearer test-api-key",
            )
            request_body = json.loads(request.content)
            self.assertEqual(request.url, "https://api.openai.com/v1/live/sessions")
            self.assertEqual(request_body["session"]["model"], "gpt-live-1")
            self.assertEqual(
                request_body["session"]["instructions"],
                ROHIT_SYSTEM_PROMPT,
            )
            self.assertEqual(
                request_body["session"]["audio"]["output"]["voice"],
                "marin",
            )
            self.assertEqual(
                request_body["session"]["client"]["data_channel"][
                    "allowed_client_events"
                ],
                ["session.close", "session.instructions.append"],
            )
            self.assertEqual(
                request_body["transport"],
                {"type": "webrtc", "sdp": "v=0\r\n"},
            )
            return httpx.Response(
                201,
                json={
                    "session": {"id": "live_test_session"},
                    "transport": {"type": "webrtc", "sdp": "v=0\r\n"},
                },
            )

        api_key_patch, client_patch = self.mock_openai_request(openai_response)
        with api_key_patch, client_patch:
            response = self.client.post(
                "/api/live/session",
                json={"sdp": "v=0\r\n"},
                headers={"Origin": "https://rohity-exe.vercel.app"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["access-control-allow-origin"],
            "https://rohity-exe.vercel.app",
        )
        self.assertEqual(
            set(response.json()),
            {
                "success",
                "session_id",
                "sdp",
                "event_token",
                "event_expires_at",
            },
        )
        self.assertEqual(response.json()["session_id"], "live_test_session")
        self.assertEqual(response.json()["sdp"], "v=0\r\n")
        self.assertTrue(response.json()["event_token"])

    def test_creates_multiple_live_sessions_consecutively(self) -> None:
        session_ids = iter(
            ("live_session_one", "live_session_two", "live_session_three")
        )

        def openai_response(request: httpx.Request) -> httpx.Response:
            session_id = next(session_ids)
            return httpx.Response(
                201,
                json={
                    "session": {"id": session_id},
                    "transport": {"type": "webrtc", "sdp": "v=0\r\n"},
                },
            )

        api_key_patch, client_patch = self.mock_openai_request(openai_response)
        with api_key_patch, client_patch:
            responses = [
                self.client.post(
                    "/api/live/session",
                    json={"sdp": "v=0\r\n"},
                    headers={"Origin": "https://rohity-exe.vercel.app"},
                )
                for _ in range(3)
            ]

        self.assertEqual([response.status_code for response in responses], [200] * 3)
        self.assertEqual(
            [response.json()["session_id"] for response in responses],
            ["live_session_one", "live_session_two", "live_session_three"],
        )
        self.assertTrue(
            all(
                response.headers["access-control-allow-origin"]
                == "https://rohity-exe.vercel.app"
                for response in responses
            )
        )

    def test_missing_api_key_returns_service_unavailable(self) -> None:
        def unexpected_request(request: httpx.Request) -> httpx.Response:
            self.fail("OpenAI should not be called without an API key")

        api_key_patch, client_patch = self.mock_openai_request(
            unexpected_request,
            api_key=None,
        )
        with api_key_patch, client_patch:
            response = self.client.post("/api/live/session", json={"sdp": "v=0\r\n"})

        self.assertEqual(response.status_code, 503)
        self.assertIn("OPENAI_API_KEY is missing", response.json()["detail"])

    def test_invalid_session_payload_returns_validation_error(self) -> None:
        origin = "https://rohity-exe.vercel.app"
        response = self.client.post(
            "/api/live/session",
            json={},
            headers={"Origin": origin},
        )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"][0]["loc"], ["body", "sdp"])
        self.assertEqual(response.headers["access-control-allow-origin"], origin)

    def test_legacy_realtime_session_route_uses_live_session_handler(self) -> None:
        def openai_response(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                201,
                json={
                    "session": {"id": "live_legacy_route"},
                    "transport": {"type": "webrtc", "sdp": "v=0\r\n"},
                },
            )

        api_key_patch, client_patch = self.mock_openai_request(openai_response)
        with api_key_patch, client_patch:
            response = self.client.post(
                "/api/realtime/session",
                json={"sdp": "v=0\r\n"},
                headers={"X-Request-ID": "12345678-1234-1234-1234-123456789abc"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["session_id"], "live_legacy_route")
        self.assertEqual(
            response.headers["x-request-id"],
            "12345678-1234-1234-1234-123456789abc",
        )

    def test_openai_api_failure_returns_gateway_error(self) -> None:
        def openai_error(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                401,
                json={"error": {"message": "Invalid API key"}},
            )

        api_key_patch, client_patch = self.mock_openai_request(openai_error)
        with api_key_patch, client_patch:
            response = self.client.post("/api/live/session", json={"sdp": "v=0\r\n"})

        self.assertEqual(response.status_code, 502)
        self.assertIn("HTTP 401", response.json()["detail"])
        self.assertIn("Invalid API key", response.json()["detail"])

    def test_openai_timeout_returns_gateway_error(self) -> None:
        def timeout(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("request timed out")

        api_key_patch, client_patch = self.mock_openai_request(timeout)
        with api_key_patch, client_patch:
            response = self.client.post("/api/live/session", json={"sdp": "v=0\r\n"})

        self.assertEqual(response.status_code, 502)
        self.assertIn("timed out", response.json()["detail"])

    def test_event_endpoint_rejects_invalid_credentials(self) -> None:
        with patch("app.config.OPENAI_API_KEY", "test-api-key"):
            response = self.client.post(
                "/api/live/events",
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
            "/api/live/events",
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
                "/api/live/events",
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
            with patch("app.routers.live.log_frontend_event", side_effect=capture_event):
                with ThreadPoolExecutor(max_workers=2) as executor:
                    responses = list(executor.map(send_event, sessions))

        self.assertEqual([response.status_code for response in responses], [202, 202])
        self.assertCountEqual(observed, sessions)

    def test_transcription_content_is_redacted_by_default(self) -> None:
        from app.routers.live import LiveEventPayload, log_frontend_event

        payload = LiveEventPayload(
            session_id="session-one",
            event_expires_at=int(time.time()) + 60,
            event="transcription.completed",
            text="A private phrase",
        )
        with patch("app.routers.live.log_event") as log:
            log_frontend_event(payload)

        self.assertIn("redacted", log.call_args.args[2])
        self.assertNotIn("A private phrase", log.call_args.args[2])

    def test_ai_response_content_can_be_enabled(self) -> None:
        from app.routers.live import LiveEventPayload, log_frontend_event

        payload = LiveEventPayload(
            session_id="session-one",
            event_expires_at=int(time.time()) + 60,
            event="ai.response.text",
            text="A generated answer",
        )
        with patch("app.routers.live.LOG_AI_RESPONSE_TEXT", True):
            with patch("app.routers.live.log_event") as log:
                log_frontend_event(payload)

        self.assertIn("A generated answer", log.call_args.args[2])


if __name__ == "__main__":
    unittest.main()
