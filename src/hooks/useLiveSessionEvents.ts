"use client";

import { useCallback, useRef } from "react";

import type { useConversationTranscript } from "@/hooks/useConversationTranscript";
import type { useVoiceDiagnostics } from "@/hooks/useVoiceDiagnostics";
import type { BackendVoiceEvent } from "@/lib/types";

type ConversationTranscript = ReturnType<typeof useConversationTranscript>;
type VoiceDiagnostics = ReturnType<typeof useVoiceDiagnostics>;
type LiveEvent = Record<string, unknown> & { type: string };

interface LiveEventCallbacks {
  onSessionStarted: (event: LiveEvent) => void;
  onSessionClosed: () => void;
  onError: (error: Error) => void;
}

interface TranscriptTurn {
  id: string;
  text: string;
  startedAt: number;
}

const TRANSCRIPT_IDLE_MS = 1_500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLiveEvent(value: unknown): value is LiveEvent {
  return isRecord(value) && typeof value.type === "string";
}

function getStringField(
  value: Record<string, unknown>,
  field: string,
): string | undefined {
  const fieldValue = value[field];
  return typeof fieldValue === "string" ? fieldValue : undefined;
}

export function useLiveSessionEvents(
  transcript: ConversationTranscript,
  diagnostics: VoiceDiagnostics,
  setStatus: (status: "listening" | "speaking") => void,
  logBackendEvent: (
    event: BackendVoiceEvent,
    text?: string,
    durationMs?: number,
  ) => void,
  logDiagnostic: (event: BackendVoiceEvent, detail?: string) => void,
) {
  const turnNumberRef = useRef(0);
  const userTurnRef = useRef<TranscriptTurn | null>(null);
  const assistantTurnRef = useRef<TranscriptTurn | null>(null);
  const assistantIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const clearAssistantIdleTimer = useCallback(() => {
    if (assistantIdleTimerRef.current !== null) {
      clearTimeout(assistantIdleTimerRef.current);
      assistantIdleTimerRef.current = null;
    }
  }, []);

  const finalizeUserTurn = useCallback(
    (status: "complete" | "interrupted" = "complete") => {
      const turn = userTurnRef.current;
      if (!turn) {
        return;
      }
      transcript.finalizeMessage(turn.id, "user", "user", turn.text, undefined, status);
      diagnostics.recordUserTranscriptCompleted();
      logBackendEvent("transcription.completed", turn.text);
      userTurnRef.current = null;
    },
    [diagnostics, logBackendEvent, transcript],
  );

  const finalizeAssistantTurn = useCallback(
    (status: "complete" | "interrupted") => {
      const turn = assistantTurnRef.current;
      if (!turn) {
        return;
      }
      clearAssistantIdleTimer();
      transcript.finalizeMessage(turn.id, "assistant", "audio", turn.text, turn.id, status);
      logBackendEvent("ai.response.text", turn.text);
      if (status === "complete") {
        logBackendEvent(
          "ai.response.completed",
          undefined,
          performance.now() - turn.startedAt,
        );
      }
      diagnostics.recordResponseCompleted(
        turn.id,
        status === "interrupted" ? "cancelled" : "completed",
      );
      assistantTurnRef.current = null;
    },
    [clearAssistantIdleTimer, diagnostics, logBackendEvent, transcript],
  );

  const reset = useCallback(() => {
    clearAssistantIdleTimer();
    turnNumberRef.current = 0;
    userTurnRef.current = null;
    assistantTurnRef.current = null;
  }, [clearAssistantIdleTimer]);

  const attachDataChannelListeners = useCallback(
    (
      channel: RTCDataChannel,
      isCurrentSession: () => boolean,
      callbacks: LiveEventCallbacks,
    ) => {
      let sessionClosed = false;
      const onMessage = (message: MessageEvent<string>) => {
        if (!isCurrentSession()) {
          return;
        }

        let event: unknown;
        try {
          event = JSON.parse(message.data);
        } catch {
          callbacks.onError(new Error("GPT-Live sent an invalid data-channel event."));
          return;
        }
        if (!isLiveEvent(event)) {
          callbacks.onError(new Error("GPT-Live sent an unsupported data-channel event."));
          return;
        }

        if (event.type === "session.started") {
          logDiagnostic("live.session.started");
          callbacks.onSessionStarted(event);
          return;
        }
        if (event.type === "session.closed") {
          sessionClosed = true;
          logDiagnostic("live.session.closed");
          finalizeAssistantTurn("complete");
          finalizeUserTurn();
          callbacks.onSessionClosed();
          return;
        }
        if (event.type === "session.instructions.appended") {
          logDiagnostic("live.instructions.acknowledged");
          return;
        }
        if (event.type === "error") {
          const error = isRecord(event.error) ? event.error : event;
          const message =
            getStringField(error, "message") ?? "GPT-Live reported an error.";
          logBackendEvent("live.error", getStringField(error, "code"));
          callbacks.onError(new Error(message));
          return;
        }

        const delta = getStringField(event, "delta");
        if (!delta) {
          return;
        }

        if (event.type === "session.input_transcript.delta") {
          if (!userTurnRef.current) {
            const id = `user:${++turnNumberRef.current}`;
            userTurnRef.current = { id, text: "", startedAt: performance.now() };
            diagnostics.recordUserTranscriptStarted();
            logBackendEvent("transcription.started");
            logBackendEvent("speech.detected");
            if (assistantTurnRef.current) {
              diagnostics.recordInterruption(
                "User spoke while GPT-Live was responding",
              );
              logBackendEvent("ai.response.interrupted");
              finalizeAssistantTurn("interrupted");
            }
          }
          const turn = userTurnRef.current;
          turn.text += delta;
          transcript.appendDelta(turn.id, "user", "user", delta);
          setStatus("listening");
          return;
        }

        if (event.type === "session.output_transcript.delta") {
          finalizeUserTurn();
          if (!assistantTurnRef.current) {
            const id = `assistant:${++turnNumberRef.current}`;
            assistantTurnRef.current = { id, text: "", startedAt: performance.now() };
            diagnostics.recordResponseStarted(id);
            logBackendEvent("ai.response.started");
          }
          const turn = assistantTurnRef.current;
          turn.text += delta;
          diagnostics.recordFirstTextDelta(turn.id);
          transcript.appendDelta(turn.id, "assistant", "audio", delta, turn.id);
          setStatus("speaking");

          clearAssistantIdleTimer();
          assistantIdleTimerRef.current = setTimeout(() => {
            assistantIdleTimerRef.current = null;
            finalizeAssistantTurn("complete");
            setStatus("listening");
          }, TRANSCRIPT_IDLE_MS);
        }
      };

      const onChannelClose = () => {
        if (isCurrentSession() && !sessionClosed) {
          callbacks.onError(new Error("The GPT-Live event channel disconnected."));
        }
      };

      channel.addEventListener("message", onMessage);
      channel.addEventListener("close", onChannelClose);

      return () => {
        channel.removeEventListener("message", onMessage);
        channel.removeEventListener("close", onChannelClose);
      };
    },
    [
      clearAssistantIdleTimer,
      diagnostics,
      finalizeAssistantTurn,
      finalizeUserTurn,
      logBackendEvent,
      logDiagnostic,
      setStatus,
      transcript,
    ],
  );

  return {
    reset,
    attachDataChannelListeners,
    finalizeAssistantTurn,
    finalizeUserTurn,
  };
}
