import { createHmac, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { ROHIT_SYSTEM_PROMPT } from "@/lib/rohitPrompt";

const OPENAI_LIVE_URL = "https://api.openai.com/v1/live/sessions";
const LIVE_MODEL = "gpt-live-1";
const EVENT_TOKEN_LIFETIME_SECONDS = 4 * 60 * 60;
const MAX_SDP_LENGTH = 64_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { detail: "OPENAI_API_KEY is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { detail: "A valid SDP offer is required." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (
    !isRecord(body) ||
    typeof body.sdp !== "string" ||
    !body.sdp.trim() ||
    body.sdp.length > MAX_SDP_LENGTH
  ) {
    return NextResponse.json(
      { detail: "A valid SDP offer is required." },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }

  const requestId = randomUUID();
  try {
    const response = await fetch(OPENAI_LIVE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          model: LIVE_MODEL,
          instructions: ROHIT_SYSTEM_PROMPT,
          audio: { output: { voice: "marin" } },
          client: {
            data_channel: {
              allowed_client_events: [
                "session.close",
                "session.instructions.append",
              ],
            },
          },
        },
        transport: { type: "webrtc", sdp: body.sdp },
      }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });

    if (!response.ok) {
      console.error(
        `[live] OpenAI returned HTTP ${response.status} for request ${requestId}`,
      );
      return NextResponse.json(
        { detail: `OpenAI GPT-Live API returned HTTP ${response.status}.` },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const data: unknown = await response.json();
    const session = isRecord(data) && isRecord(data.session) ? data.session : null;
    const transport =
      isRecord(data) && isRecord(data.transport) ? data.transport : null;
    if (
      !session ||
      typeof session.id !== "string" ||
      !session.id ||
      !transport ||
      typeof transport.sdp !== "string" ||
      !transport.sdp
    ) {
      console.error(`[live] OpenAI returned an invalid response for request ${requestId}`);
      return NextResponse.json(
        { detail: "OpenAI GPT-Live API returned an invalid response." },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const eventExpiresAt =
      Math.floor(Date.now() / 1000) + EVENT_TOKEN_LIFETIME_SECONDS;
    const eventToken = createHmac("sha256", apiKey)
      .update(`${session.id}:${eventExpiresAt}`)
      .digest("hex");

    return NextResponse.json(
      {
        success: true,
        session_id: session.id,
        sdp: transport.sdp,
        event_token: eventToken,
        event_expires_at: eventExpiresAt,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "TimeoutError"
        ? "The OpenAI GPT-Live API request timed out."
        : "Could not reach the OpenAI GPT-Live API.";
    console.error(`[live] ${reason} for request ${requestId}`);
    return NextResponse.json(
      { detail: reason },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
