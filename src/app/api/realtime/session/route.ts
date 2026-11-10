import { createHmac, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { ROHIT_SYSTEM_PROMPT } from "@/lib/rohitPrompt";

const OPENAI_REALTIME_URL =
  "https://api.openai.com/v1/realtime/client_secrets";
const REALTIME_MODEL = "gpt-realtime-2.1";
const EVENT_TOKEN_LIFETIME_SECONDS = 4 * 60 * 60;

export async function POST() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { detail: "OPENAI_API_KEY is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const sessionId = randomUUID();
  try {
    const response = await fetch(OPENAI_REALTIME_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: REALTIME_MODEL,
          instructions: ROHIT_SYSTEM_PROMPT,
          audio: {
            input: {
              noise_reduction: { type: "near_field" },
              turn_detection: { type: "server_vad" },
            },
            output: { voice: "marin" },
          },
        },
      }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });

    if (!response.ok) {
      console.error(
        `[realtime] OpenAI returned HTTP ${response.status} for session ${sessionId}`,
      );
      return NextResponse.json(
        { detail: `OpenAI Realtime API returned HTTP ${response.status}.` },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const data: unknown = await response.json();
    if (
      typeof data !== "object" ||
      data === null ||
      !("value" in data) ||
      typeof data.value !== "string" ||
      !data.value ||
      !("expires_at" in data) ||
      typeof data.expires_at !== "number" ||
      !Number.isInteger(data.expires_at)
    ) {
      console.error(`[realtime] OpenAI returned an invalid response for session ${sessionId}`);
      return NextResponse.json(
        { detail: "OpenAI Realtime API returned an invalid response." },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const eventExpiresAt = Math.floor(Date.now() / 1000) + EVENT_TOKEN_LIFETIME_SECONDS;
    const eventToken = createHmac("sha256", apiKey)
      .update(`${sessionId}:${eventExpiresAt}`)
      .digest("hex");

    return NextResponse.json(
      {
        success: true,
        client_secret: data.value,
        expires_at: data.expires_at,
        instructions: ROHIT_SYSTEM_PROMPT,
        session_id: sessionId,
        event_token: eventToken,
        event_expires_at: eventExpiresAt,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "TimeoutError"
        ? "The OpenAI Realtime API request timed out."
        : "Could not reach the OpenAI Realtime API.";
    console.error(`[realtime] ${reason} for session ${sessionId}`);
    return NextResponse.json(
      { detail: reason },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
