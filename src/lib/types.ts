export interface SessionResponse {
  success: true;
  session_id: string;
  sdp: string;
  event_token: string;
  event_expires_at: number;
}

export type BackendVoiceEvent =
  | "voice.button.clicked"
  | "voice.session.creation.started"
  | "voice.session.creation.completed"
  | "session.connected"
  | "session.disconnected"
  | "microphone.connected"
  | "microphone.permission.granted"
  | "microphone.disconnected"
  | "webrtc.peer.created"
  | "webrtc.connection.state"
  | "webrtc.ice.state"
  | "webrtc.data_channel.opened"
  | "live.session.created"
  | "live.session.started"
  | "live.session.closed"
  | "live.instructions.sent"
  | "live.instructions.acknowledged"
  | "live.transcript.delta"
  | "audio.remote_track.received"
  | "audio.element.attached"
  | "audio.element.play_resolved"
  | "audio.element.playing"
  | "audio.element.play_error"
  | "audio.track.muted"
  | "audio.track.unmuted"
  | "audio.playback.started"
  | "initialization.music.stopped"
  | "ui.cat.shown"
  | "ui.cat.hidden"
  | "ui.initialization.changed"
  | "speech.detected"
  | "transcription.started"
  | "transcription.completed"
  | "transcription.failed"
  | "ai.response.started"
  | "ai.response.text"
  | "ai.audio.generation_started"
  | "ai.audio.playback_started"
  | "ai.response.completed"
  | "ai.response.interrupted"
  | "audio.input"
  | "audio.output"
  | "audio.connection.failed"
  | "audio.reconnected"
  | "api.failure"
  | "webrtc.failure"
  | "live.error"
  | "audio.playback.failure"
  | "unexpected.exception"
  | "latency.response";

export type TranscriptSpeaker = "user" | "assistant";
export type TranscriptStatus = "generating" | "complete" | "interrupted";
export type TranscriptSource = "user" | "audio" | "text";

export interface TranscriptMessage {
  id: string;
  responseId?: string;
  speaker: TranscriptSpeaker;
  source: TranscriptSource;
  text: string;
  status: TranscriptStatus;
}

export interface DiagnosticLogEntry {
  id: number;
  timestamp: number;
  performanceTime: number;
  event: string;
  detail?: string;
}

export interface VoiceLatencyMetrics {
  credentialCreationMs: number | null;
  webRtcConnectionMs: number | null;
  speechEndToResponseStartMs: number | null;
  speechEndToFirstTextDeltaMs: number | null;
  speechEndToFirstAudioMs: number | null;
  interruptionToAudioStopMs: number | null;
  totalResponseMs: number | null;
}

export function isSessionResponse(value: unknown): value is SessionResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const response = value as Record<string, unknown>;

  return (
    response.success === true &&
    typeof response.session_id === "string" &&
    typeof response.sdp === "string" &&
    response.sdp.length > 0 &&
    typeof response.event_token === "string" &&
    typeof response.event_expires_at === "number" &&
    Number.isFinite(response.event_expires_at)
  );
}
