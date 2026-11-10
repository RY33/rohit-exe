"use client";

import { useCallback, useRef } from "react";
import type { RealtimeSession } from "@openai/agents/realtime";

import type { useConversationTranscript } from "@/hooks/useConversationTranscript";
import type { useVoiceDiagnostics } from "@/hooks/useVoiceDiagnostics";
import type { BackendVoiceEvent } from "@/lib/types";

type ConversationTranscript = ReturnType<typeof useConversationTranscript>;
type VoiceDiagnostics = ReturnType<typeof useVoiceDiagnostics>;

type RealtimeEvent = Record<string, unknown> & { type: string };

type RawRealtimeEventSource = {
  on(eventType: string, listener: (event: unknown) => void): unknown;
  off(eventType: string, listener: (event: unknown) => void): unknown;
};

const REALTIME_EVENT_TYPES = [
  "session.created",
  "session.updated",
  "response.created",
  "response.output_item.added",
  "response.output_audio.delta",
  "response.output_audio.done",
  "response.output_audio_transcript.delta",
  "response.output_audio_transcript.done",
  "response.output_text.delta",
  "response.output_text.done",
  "response.done",
  "response.failed",
  "output_audio_buffer.started",
  "output_audio_buffer.stopped",
  "output_audio_buffer.cleared",
  "input_audio_buffer.speech_started",
  "input_audio_buffer.speech_stopped",
  "conversation.item.input_audio_transcription.delta",
  "conversation.item.input_audio_transcription.completed",
  "conversation.item.input_audio_transcription.failed",
  "error",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStringField(
  value: Record<string, unknown>,
  field: string,
): string | undefined {
  const fieldValue = value[field];
  return typeof fieldValue === "string" ? fieldValue : undefined;
}

export function useRealtimeSessionEvents(
  transcript: ConversationTranscript,
  diagnostics: VoiceDiagnostics,
  setStatus: (status: "listening" | "speaking") => void,
  handleFirstAiAudioStarted: () => void,
  onInitialGreetingFinished: () => void,
  onSessionConfigured: () => void,
  logBackendEvent: (
    event: BackendVoiceEvent,
    text?: string,
    durationMs?: number,
  ) => void,
  logDiagnostic: (event: BackendVoiceEvent, detail?: string) => void,
) {
  const activeResponseIdRef = useRef<string | null>(null);
  const lastResponseIdRef = useRef<string | null>(null);
  const interruptedResponseIdsRef = useRef(new Set<string>());
  const userTranscriptIdsRef = useRef(new Set<string>());
  const responseStartedAtRef = useRef(new Map<string, number>());
  const playbackStartedResponseIdsRef = useRef(new Set<string>());
  const audioGenerationStartedResponseIdsRef = useRef(new Set<string>());
  const completedResponseIdsRef = useRef(new Set<string>());
  const loggedResponseTextIdsRef = useRef(new Set<string>());
  const firstAssistantAudioStartedRef = useRef(false);
  const firstAssistantAudioGeneratedRef = useRef(false);
  const remoteAudioTrackUnmutedRef = useRef(false);
  const remoteAudioElementPlayingRef = useRef(false);
  const playbackReadinessCheckRef = useRef<(() => void) | null>(null);
  const initialGreetingFinishedRef = useRef(false);
  const connectionCountRef = useRef(0);

  const reset = useCallback(() => {
    activeResponseIdRef.current = null;
    lastResponseIdRef.current = null;
    interruptedResponseIdsRef.current.clear();
    userTranscriptIdsRef.current.clear();
    responseStartedAtRef.current.clear();
    playbackStartedResponseIdsRef.current.clear();
    audioGenerationStartedResponseIdsRef.current.clear();
    completedResponseIdsRef.current.clear();
    loggedResponseTextIdsRef.current.clear();
    firstAssistantAudioStartedRef.current = false;
    firstAssistantAudioGeneratedRef.current = false;
    remoteAudioTrackUnmutedRef.current = false;
    remoteAudioElementPlayingRef.current = false;
    playbackReadinessCheckRef.current = null;
    initialGreetingFinishedRef.current = false;
    connectionCountRef.current = 0;
  }, []);

  const attachSessionListeners = useCallback(
    (
      session: RealtimeSession,
      isCurrentSession: () => boolean,
      onSessionError: (error: unknown) => void,
      remoteAudioElement: HTMLAudioElement,
    ) => {
      let isCleanedUp = false;
      const onConnectionChange = (
        connectionStatus: "connecting" | "connected" | "disconnected",
      ) => {
        if (isCurrentSession()) {
          diagnostics.recordWebRtcStatus(connectionStatus);
          if (connectionStatus === "connected") {
            connectionCountRef.current += 1;
            if (connectionCountRef.current === 1) {
              logDiagnostic("webrtc.data_channel.opened");
            }
            logBackendEvent(
              connectionCountRef.current === 1
                ? "session.connected"
                : "audio.reconnected",
            );
            if (connectionCountRef.current === 1) {
              logBackendEvent("audio.input");
            }
          } else if (connectionStatus === "disconnected") {
            logBackendEvent("audio.connection.failed");
            if (connectionCountRef.current > 0) {
              onSessionError(
                new Error("The Realtime connection was disconnected."),
              );
            }
          }
        }
      };
      const onTransportEvent = (event: unknown) => {
        if (isCurrentSession() && isRecord(event) && typeof event.type === "string") {
          if (event.type === "session.updated") {
            logDiagnostic("realtime.session.config.confirmed");
            onSessionConfigured();
          } else if (event.type === "response.created") {
            logDiagnostic("realtime.response.created");
          } else if (event.type === "response.output_item.added") {
            logDiagnostic("realtime.output_item.added");
          } else if (event.type === "response.output_audio.delta") {
            const responseId = getStringField(event, "response_id");
            if (
              !responseId ||
              !audioGenerationStartedResponseIdsRef.current.has(responseId)
            ) {
              logDiagnostic("realtime.audio.delta");
            }
            firstAssistantAudioGeneratedRef.current = true;
          } else if (event.type === "response.output_audio.done") {
            logDiagnostic("realtime.audio.done");
          } else if (event.type === "response.done") {
            logDiagnostic("realtime.response.done");
          } else if (event.type === "response.failed") {
            logDiagnostic("realtime.response.failed");
            const response = isRecord(event.response) ? event.response : null;
            const statusDetails =
              response && isRecord(response.status_details)
                ? response.status_details
                : null;
            const failure =
              statusDetails && isRecord(statusDetails.error)
                ? statusDetails.error
                : null;
            const failureMessage =
              (failure && getStringField(failure, "message")) ??
              "The initial Realtime response failed.";
            onSessionError(new Error(failureMessage));
            return;
          }
          if (event.type === "output_audio_buffer.stopped") {
            handleInitialGreetingFinished();
          }
          handleRealtimeEvent({ ...event, type: event.type });
          playbackReadinessCheckRef.current?.();
        }
      };
      const handleAudioPlaybackStarted = () => {
        setStatus("speaking");
        const responseId =
          activeResponseIdRef.current ?? lastResponseIdRef.current;
        if (
          responseId &&
          !playbackStartedResponseIdsRef.current.has(responseId)
        ) {
          playbackStartedResponseIdsRef.current.add(responseId);
          logBackendEvent("ai.audio.playback_started");
          logBackendEvent("audio.output");
        }
        if (!firstAssistantAudioStartedRef.current) {
          diagnostics.log("Initial AI audio playback started");
          firstAssistantAudioStartedRef.current = true;
          handleFirstAiAudioStarted();
          logDiagnostic("audio.playback.started");
        }
        if (activeResponseIdRef.current) {
          diagnostics.recordFirstAudio(activeResponseIdRef.current);
        }
      };
      const checkPlaybackReadiness = () => {
        if (
          !firstAssistantAudioStartedRef.current &&
          firstAssistantAudioGeneratedRef.current &&
          remoteAudioTrackUnmutedRef.current &&
          remoteAudioElementPlayingRef.current &&
          !remoteAudioElement.paused &&
          !remoteAudioElement.muted
        ) {
          handleAudioPlaybackStarted();
        }
      };
      playbackReadinessCheckRef.current = checkPlaybackReadiness;
      const onRemoteAudioPlaying = () => {
        if (isCurrentSession()) {
          remoteAudioElementPlayingRef.current = true;
          const tracks = remoteAudioElement.srcObject instanceof MediaStream
            ? remoteAudioElement.srcObject.getAudioTracks()
            : [];
          remoteAudioTrackUnmutedRef.current = tracks.some(
            (track) => track.enabled && !track.muted && track.readyState === "live",
          );
          const trackStates = tracks
            .map(
              (track) =>
                `enabled=${track.enabled},muted=${track.muted},state=${track.readyState}`,
            )
            .join(";");
          logDiagnostic(
            "audio.element.playing",
            `elementMuted=${remoteAudioElement.muted}; volume=${remoteAudioElement.volume}; ${trackStates}`,
          );
          checkPlaybackReadiness();
        }
      };
      const onRemoteAudioPause = () => {
        remoteAudioElementPlayingRef.current = false;
      };
      const handleInitialGreetingFinished = () => {
        if (
          firstAssistantAudioStartedRef.current &&
          !initialGreetingFinishedRef.current
        ) {
          initialGreetingFinishedRef.current = true;
          onInitialGreetingFinished();
        }
      };
      const onAudioStopped = () => {
        if (isCurrentSession()) {
          diagnostics.recordAudioStopped("AI audio generation stopped");
          const responseId =
            activeResponseIdRef.current ?? lastResponseIdRef.current;
          if (
            responseId &&
            !completedResponseIdsRef.current.has(responseId)
          ) {
            completedResponseIdsRef.current.add(responseId);
            const startedAt = responseStartedAtRef.current.get(responseId);
            logBackendEvent(
              "ai.response.completed",
              undefined,
              startedAt === undefined
                ? undefined
                : performance.now() - startedAt,
            );
          }
          if (firstAssistantAudioStartedRef.current) {
            handleInitialGreetingFinished();
            setStatus("listening");
          }
        }
      };
      const onAudioInterrupted = () => {
        if (isCurrentSession()) {
          const responseId = activeResponseIdRef.current;
          if (responseId) {
            interruptedResponseIdsRef.current.add(responseId);
            transcript.setResponseStatus(responseId, "interrupted");
            logBackendEvent("ai.response.interrupted");
          }
          diagnostics.recordInterruption();
          if (firstAssistantAudioStartedRef.current) {
            setStatus("listening");
          }
        }
      };
      const onError = (event: { error: unknown }) => {
        if (isCurrentSession()) {
          cleanup();
          logBackendEvent(
            "realtime.error",
            event.error instanceof Error ? event.error.name : undefined,
          );
          onSessionError(event.error);
        }
      };

      function cleanup() {
        if (isCleanedUp) {
          return;
        }
        isCleanedUp = true;
        session.transport.off("connection_change", onConnectionChange);
        const rawEvents = session.transport as RawRealtimeEventSource;
        for (const eventType of REALTIME_EVENT_TYPES) {
          rawEvents.off(eventType, onTransportEvent);
        }
        session.off("audio_stopped", onAudioStopped);
        session.off("audio_interrupted", onAudioInterrupted);
        session.off("error", onError);
        remoteAudioElement.removeEventListener("playing", onRemoteAudioPlaying);
        remoteAudioElement.removeEventListener("pause", onRemoteAudioPause);
        playbackReadinessCheckRef.current = null;
      }

      session.transport.on("connection_change", onConnectionChange);
      // The browser SDK's wildcard relay drops raw events, so subscribe by event type.
      const rawEvents = session.transport as RawRealtimeEventSource;
      for (const eventType of REALTIME_EVENT_TYPES) {
        rawEvents.on(eventType, onTransportEvent);
      }
      session.on("audio_stopped", onAudioStopped);
      session.on("audio_interrupted", onAudioInterrupted);
      session.on("error", onError);
      remoteAudioElement.addEventListener("playing", onRemoteAudioPlaying);
      remoteAudioElement.addEventListener("pause", onRemoteAudioPause);

      return cleanup;
    },
    [
      diagnostics,
      handleFirstAiAudioStarted,
      onInitialGreetingFinished,
      onSessionConfigured,
      logBackendEvent,
      logDiagnostic,
      setStatus,
      transcript,
    ],
  );

  const notifyRemoteAudioTrackUnmuted = useCallback(() => {
    remoteAudioTrackUnmutedRef.current = true;
    playbackReadinessCheckRef.current?.();
  }, []);

  function handleRealtimeEvent(event: RealtimeEvent) {
    const { type } = event;

    if (type === "input_audio_buffer.speech_started") {
      diagnostics.recordUserSpeechStarted();
      logBackendEvent("speech.detected");
      logBackendEvent("vad.speech_started");
      if (activeResponseIdRef.current) {
        diagnostics.recordInterruption(
          "User speech detected during AI response",
        );
        logBackendEvent("ai.response.interrupted");
      }
      return;
    }
    if (type === "input_audio_buffer.speech_stopped") {
      diagnostics.recordUserSpeechStopped();
      logBackendEvent("vad.speech_stopped");
      return;
    }
    if (type === "conversation.item.input_audio_transcription.delta") {
      const itemId = getStringField(event, "item_id");
      const delta = getStringField(event, "delta");
      if (itemId && delta) {
        if (!userTranscriptIdsRef.current.has(itemId)) {
          userTranscriptIdsRef.current.add(itemId);
          diagnostics.recordUserTranscriptStarted();
          logBackendEvent("transcription.started");
        }
        transcript.appendDelta(itemId, "user", "user", delta);
      }
      return;
    }
    if (type === "conversation.item.input_audio_transcription.completed") {
      const itemId = getStringField(event, "item_id");
      const text = getStringField(event, "transcript");
      if (itemId && text !== undefined) {
        transcript.finalizeMessage(itemId, "user", "user", text);
        diagnostics.recordUserTranscriptCompleted();
        logBackendEvent("transcription.completed", text);
      }
      return;
    }
    if (type === "conversation.item.input_audio_transcription.failed") {
      logBackendEvent("transcription.failed");
      return;
    }
    if (type === "response.created" && isRecord(event.response)) {
      const responseId = getStringField(event.response, "id");
      if (responseId) {
        activeResponseIdRef.current = responseId;
        lastResponseIdRef.current = responseId;
        responseStartedAtRef.current.set(responseId, performance.now());
        diagnostics.recordResponseStarted(responseId);
        logBackendEvent("ai.response.started");
      }
      return;
    }
    if (
      type === "response.output_audio_transcript.delta" ||
      type === "response.output_text.delta"
    ) {
      const itemId = getStringField(event, "item_id");
      const responseId = getStringField(event, "response_id");
      const delta = getStringField(event, "delta");
      if (itemId && responseId && delta) {
        activeResponseIdRef.current = responseId;
        diagnostics.recordFirstTextDelta(responseId);
        transcript.appendDelta(
          itemId,
          "assistant",
          type === "response.output_text.delta" ? "text" : "audio",
          delta,
          responseId,
        );
      }
      return;
    }
    if (
      type === "response.output_audio_transcript.done" ||
      type === "response.output_text.done"
    ) {
      const itemId = getStringField(event, "item_id");
      const responseId = getStringField(event, "response_id");
      const text =
        getStringField(event, "transcript") ?? getStringField(event, "text");
      if (itemId && responseId && text !== undefined) {
        if (!loggedResponseTextIdsRef.current.has(responseId)) {
          loggedResponseTextIdsRef.current.add(responseId);
          logBackendEvent("ai.response.text", text);
        }
        const source = type === "response.output_text.done" ? "text" : "audio";
        const status = interruptedResponseIdsRef.current.has(responseId)
          ? "interrupted"
          : "complete";
        transcript.finalizeMessage(
          itemId,
          "assistant",
          source,
          text,
          responseId,
          status,
        );
      }
      return;
    }
    if (type === "response.output_audio.delta") {
      const responseId = getStringField(event, "response_id");
      if (
        responseId &&
        !audioGenerationStartedResponseIdsRef.current.has(responseId)
      ) {
        audioGenerationStartedResponseIdsRef.current.add(responseId);
        logBackendEvent("ai.audio.generation_started");
        diagnostics.recordFirstAudio(responseId);
      }
      return;
    }
    if (type === "response.done" && isRecord(event.response)) {
      const responseId = getStringField(event.response, "id");
      const responseStatus = getStringField(event.response, "status");
      if (responseId) {
        const interrupted =
          responseStatus === "cancelled" ||
          interruptedResponseIdsRef.current.has(responseId);
        transcript.setResponseStatus(
          responseId,
          interrupted ? "interrupted" : "complete",
        );
        diagnostics.recordResponseCompleted(responseId, responseStatus);
        const startedAt = responseStartedAtRef.current.get(responseId);
        if (startedAt !== undefined) {
          logBackendEvent(
            "latency.response",
            undefined,
            performance.now() - startedAt,
          );
        }
        if (
          responseStatus === "cancelled" &&
          !interruptedResponseIdsRef.current.has(responseId)
        ) {
          interruptedResponseIdsRef.current.add(responseId);
          logBackendEvent("ai.response.interrupted");
        }
        if (activeResponseIdRef.current === responseId) {
          activeResponseIdRef.current = null;
        }
      }
      return;
    }
    if (type === "output_audio_buffer.started") {
      diagnostics.log("AI audio playback started");
      logDiagnostic("realtime.audio.buffer.started");
      firstAssistantAudioGeneratedRef.current = true;
      return;
    }
    if (type === "output_audio_buffer.stopped") {
      diagnostics.recordAudioStopped("AI audio playback stopped", true);
      return;
    }
    if (type === "output_audio_buffer.cleared") {
      const responseId = activeResponseIdRef.current;
      if (responseId) {
        interruptedResponseIdsRef.current.add(responseId);
        transcript.setResponseStatus(responseId, "interrupted");
      }
      diagnostics.recordAudioStopped("Previous audio playback stopped", true);
      return;
    }
    if (type === "error") {
      const error = isRecord(event.error) ? event.error : event;
      const message =
        getStringField(error, "message") ?? "OpenAI Realtime API error.";
      diagnostics.recordError("OpenAI Realtime API error", message);
      logBackendEvent("realtime.error", getStringField(error, "code"));
    }
  }

  return {
    reset,
    attachSessionListeners,
    handleRealtimeEvent,
    notifyRemoteAudioTrackUnmuted,
  };
}
