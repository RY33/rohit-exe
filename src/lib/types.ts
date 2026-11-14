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
  | "audio.analysis.started"
  | "audio.analysis.resume_failed"
  | "audio.analysis.close_failed"
  | "audio.analysis.unavailable"
  | "assistant.first_audio.received"
  | "assistant.first_audio.playback_started"
  | "initialization.music.stopped"
  | "ui.cat.shown"
  | "ui.cat.hidden"
  | "ui.cat.hide.triggered"
  | "ui.initialization.changed"
  | "happy_reaction.entered"
  | "happy_reaction.timer.started"
  | "happy_reaction.exited"
  | "happy_cat.component.mounted"
  | "happy_cat.image.loading"
  | "happy_cat.image.loaded"
  | "happy_cat.image.error"
  | "happy_cat.visibility.changed"
  | "happy_cat.animation.started"
  | "happy_cat.animation.completed"
  | "happy_reaction.backdrop.animation.started"
  | "happy_reaction.backdrop.animation.completed"
  | "happy_music.started"
  | "happy_music.completed"
  | "sad_reaction.entered"
  | "sad_reaction.timer.started"
  | "sad_reaction.exited"
  | "sad_reaction.backdrop.animation.started"
  | "sad_reaction.backdrop.animation.completed"
  | "reaction_meme.component.mounted"
  | "reaction_meme.image.loading"
  | "reaction_meme.image.loaded"
  | "reaction_meme.image.error"
  | "reaction_meme.visibility.changed"
  | "reaction_music.error"
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
