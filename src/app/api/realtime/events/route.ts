import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

const EVENTS: Record<string, { category: string; label: string }> = {
  "voice.button.clicked": { category: "VOICE", label: "Speak button clicked" },
  "voice.session.creation.started": { category: "VOICE", label: "Session creation started" },
  "voice.session.creation.completed": { category: "VOICE", label: "Session creation completed" },
  "session.connected": { category: "WEBRTC", label: "Connection established" },
  "session.disconnected": { category: "SESSION", label: "Session disconnected" },
  "microphone.permission.granted": { category: "VOICE", label: "Microphone permission granted" },
  "microphone.connected": { category: "AUDIO", label: "Microphone audio connected" },
  "microphone.disconnected": { category: "AUDIO", label: "Microphone audio disconnected" },
  "webrtc.peer.created": { category: "WEBRTC", label: "RTCPeerConnection created" },
  "webrtc.connection.state": { category: "WEBRTC", label: "Peer connection state changed" },
  "webrtc.ice.state": { category: "WEBRTC", label: "ICE connection state changed" },
  "webrtc.data_channel.opened": { category: "WEBRTC", label: "Realtime data channel opened" },
  "realtime.session.created": { category: "REALTIME", label: "Realtime session object created" },
  "realtime.session.config.sent": { category: "REALTIME", label: "Session configuration sent" },
  "realtime.session.config.confirmed": { category: "REALTIME", label: "Session configuration confirmed" },
  "realtime.response.create.sent": { category: "REALTIME", label: "Initial response.create sent" },
  "realtime.response.created": { category: "REALTIME", label: "response.created received" },
  "realtime.output_item.added": { category: "REALTIME", label: "response.output_item.added received" },
  "realtime.audio.buffer.started": { category: "REALTIME", label: "output_audio_buffer.started received" },
  "realtime.audio.delta": { category: "REALTIME", label: "response.output_audio.delta received" },
  "realtime.audio.done": { category: "REALTIME", label: "response.output_audio.done received" },
  "realtime.response.done": { category: "REALTIME", label: "response.done received" },
  "realtime.response.failed": { category: "ERROR", label: "response.failed received" },
  "audio.remote_track.received": { category: "AUDIO", label: "Remote audio track received" },
  "audio.element.attached": { category: "AUDIO", label: "Remote stream attached to audio element" },
  "audio.element.play_resolved": { category: "AUDIO", label: "Remote audio play() promise resolved" },
  "audio.element.playing": { category: "AUDIO", label: "Remote audio element playing" },
  "audio.element.play_error": { category: "ERROR", label: "Remote audio element playback failed" },
  "audio.track.muted": { category: "AUDIO", label: "Remote audio track muted" },
  "audio.track.unmuted": { category: "AUDIO", label: "Remote audio track unmuted" },
  "audio.playback.started": { category: "AUDIO", label: "Actual remote audio playback started" },
  "initialization.music.stopped": { category: "AUDIO", label: "Initialization music stopped" },
  "ui.cat.shown": { category: "UI", label: "Initialization cat shown" },
  "ui.cat.hidden": { category: "UI", label: "Initialization cat hidden" },
  "ui.initialization.changed": { category: "UI", label: "Initialization status changed" },
  "speech.detected": { category: "TRANSCRIPTION", label: "User speech detected" },
  "transcription.started": { category: "TRANSCRIPTION", label: "Transcription started" },
  "transcription.completed": { category: "TRANSCRIPTION", label: "Final text" },
  "transcription.failed": { category: "TRANSCRIPTION", label: "Transcription failed" },
  "ai.response.started": { category: "AI", label: "Response generation started" },
  "ai.response.text": { category: "AI", label: "Generated" },
  "ai.audio.generation_started": { category: "AUDIO", label: "AI audio generation started" },
  "ai.audio.playback_started": { category: "AUDIO", label: "AI audio playback started" },
  "ai.response.completed": { category: "AI", label: "AI speech completed" },
  "ai.response.interrupted": { category: "AI", label: "AI response interrupted" },
  "audio.input": { category: "AUDIO", label: "Incoming audio stream active" },
  "audio.output": { category: "AUDIO", label: "Outgoing audio stream active" },
  "audio.connection.failed": { category: "AUDIO", label: "Audio connection failed" },
  "audio.reconnected": { category: "WEBRTC", label: "Audio connection re-established" },
  "vad.speech_started": { category: "AUDIO", label: "VAD speech-start event" },
  "vad.speech_stopped": { category: "AUDIO", label: "VAD speech-stop event" },
  "api.failure": { category: "ERROR", label: "API request failed" },
  "webrtc.failure": { category: "ERROR", label: "WebRTC connection failed" },
  "realtime.error": { category: "ERROR", label: "Realtime connection error" },
  "audio.playback.failure": { category: "ERROR", label: "Audio playback failed" },
  "unexpected.exception": { category: "ERROR", label: "Unexpected client exception" },
  "latency.response": { category: "LATENCY", label: "Response generation duration" },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createEventToken(sessionId: string, expiresAt: number, signingKey: string): Buffer {
  return createHmac("sha256", signingKey)
    .update(`${sessionId}:${expiresAt}`)
    .digest();
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body." }, { status: 400 });
  }

  if (!isRecord(payload)) {
    return NextResponse.json({ detail: "Invalid event payload." }, { status: 422 });
  }

  const { session_id: sessionId, event_expires_at: expiresAt, event, text, duration_ms: durationMs } = payload;
  if (
    typeof sessionId !== "string" ||
    sessionId.length < 1 ||
    sessionId.length > 64 ||
    typeof expiresAt !== "number" ||
    !Number.isInteger(expiresAt) ||
    typeof event !== "string" ||
    event.length < 1 ||
    event.length > 64 ||
    (text !== undefined && text !== null && (typeof text !== "string" || text.length > 2000)) ||
    (durationMs !== undefined &&
      durationMs !== null &&
      (typeof durationMs !== "number" ||
        !Number.isFinite(durationMs) ||
        durationMs < 0 ||
        durationMs > 3_600_000))
  ) {
    return NextResponse.json({ detail: "Invalid event payload." }, { status: 422 });
  }

  const eventInfo = EVENTS[event];
  if (!eventInfo) {
    return NextResponse.json({ detail: "Unsupported event." }, { status: 422 });
  }
  if (expiresAt <= Math.floor(Date.now() / 1000)) {
    return NextResponse.json({ detail: "Event credential expired." }, { status: 401 });
  }

  const signingKey = process.env.OPENAI_API_KEY;
  const suppliedToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!signingKey || !suppliedToken || !/^[a-f0-9]{64}$/i.test(suppliedToken)) {
    return NextResponse.json({ detail: "Invalid event credential." }, { status: 401 });
  }

  const expectedToken = createEventToken(sessionId, expiresAt, signingKey);
  const actualToken = Buffer.from(suppliedToken, "hex");
  if (!timingSafeEqual(actualToken, expectedToken)) {
    return NextResponse.json({ detail: "Invalid event credential." }, { status: 401 });
  }

  const eventText = typeof text === "string" ? text : "";
  let message = eventInfo.label;
  if (event === "transcription.completed") {
    message =
      ["1", "true", "yes"].includes(process.env.LOG_TRANSCRIPT_TEXT?.toLowerCase() ?? "") &&
      eventText
        ? `Final text: "${eventText.replace(/\s+/g, " ").slice(0, 2000)}"`
        : "Transcription completed (text redacted)";
  } else if (event === "ai.response.text") {
    message =
      ["1", "true", "yes"].includes(process.env.LOG_AI_RESPONSE_TEXT?.toLowerCase() ?? "") &&
      eventText
        ? `Generated: "${eventText.replace(/\s+/g, " ").slice(0, 2000)}"`
        : "AI response generated (text redacted)";
  }
  if (typeof durationMs === "number") {
    message += ` (${durationMs.toFixed(1)} ms)`;
  }
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64) || "-";
  const log = eventInfo.category === "ERROR" ? console.error : console.info;
  log(`[${eventInfo.category}] [session=${safeSessionId}] ${message}`);

  return NextResponse.json({ accepted: true }, { status: 202 });
}
