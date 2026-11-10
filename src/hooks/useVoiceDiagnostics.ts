"use client";

import { useCallback, useRef, useState } from "react";

import type {
  DiagnosticLogEntry,
  VoiceLatencyMetrics,
} from "@/lib/types";
import {
  elapsedMilliseconds,
  EMPTY_LATENCY_METRICS,
  redactSensitiveText,
} from "@/lib/diagnostics";

interface ResponseTiming {
  startedAt: number;
  firstTextAt?: number;
  firstAudioAt?: number;
}

interface DiagnosticTimes {
  credentialStartedAt: number | null;
  connectionStartedAt: number | null;
  speechStoppedAt: number | null;
  interruptionAt: number | null;
  responses: Map<string, ResponseTiming>;
}

function createDiagnosticTimes(): DiagnosticTimes {
  return {
    credentialStartedAt: null,
    connectionStartedAt: null,
    speechStoppedAt: null,
    interruptionAt: null,
    responses: new Map(),
  };
}

export function useVoiceDiagnostics() {
  const [entries, setEntries] = useState<DiagnosticLogEntry[]>([]);
  const [metrics, setMetrics] =
    useState<VoiceLatencyMetrics>(EMPTY_LATENCY_METRICS);
  const [paused, setPaused] = useState(false);
  const entriesRef = useRef<DiagnosticLogEntry[]>([]);
  const pausedRef = useRef(false);
  const nextEntryIdRef = useRef(0);
  const timesRef = useRef<DiagnosticTimes>(createDiagnosticTimes());
  const connectionRecordedRef = useRef(false);

  const log = useCallback((event: string, detail?: string) => {
    const entry: DiagnosticLogEntry = {
      id: nextEntryIdRef.current++,
      timestamp: Date.now(),
      performanceTime: performance.now(),
      event,
      detail: detail ? redactSensitiveText(detail) : undefined,
    };
    entriesRef.current = [...entriesRef.current, entry];
    if (!pausedRef.current) {
      setEntries(entriesRef.current);
    }
    return entry.performanceTime;
  }, []);

  const clearLogs = useCallback(() => {
    entriesRef.current = [];
    setEntries([]);
  }, []);

  const togglePaused = useCallback(() => {
    const shouldPause = !pausedRef.current;
    pausedRef.current = shouldPause;
    setPaused(shouldPause);
    if (!shouldPause) {
      setEntries(entriesRef.current);
    }
  }, []);

  const startConversation = useCallback(() => {
    timesRef.current = createDiagnosticTimes();
    setMetrics({ ...EMPTY_LATENCY_METRICS });
    clearLogs();
    log("Conversation started");
  }, [clearLogs, log]);

  const beginCredentialRequest = useCallback(() => {
    timesRef.current.credentialStartedAt = performance.now();
    log("Backend credential request started");
  }, [log]);

  const finishCredentialRequest = useCallback(
    (success: boolean) => {
      const completedAt = performance.now();
      const duration = elapsedMilliseconds(
        timesRef.current.credentialStartedAt,
        completedAt,
      );
      setMetrics((current) => ({
        ...current,
        credentialCreationMs: duration,
      }));
      log(
        "Backend credential request completed",
        duration === null
          ? success
            ? undefined
            : "Request failed"
          : `${Math.round(duration)} ms${success ? "" : " (failed)"}`,
      );
    },
    [log],
  );

  const beginWebRtcConnection = useCallback(() => {
    timesRef.current.connectionStartedAt = performance.now();
    connectionRecordedRef.current = false;
    log("WebRTC connection started");
  }, [log]);

  const recordWebRtcStatus = useCallback(
    (status: "connecting" | "connected" | "disconnected" | "disconnecting") => {
      if (status === "connected") {
        if (connectionRecordedRef.current) {
          return;
        }
        connectionRecordedRef.current = true;
        const duration = elapsedMilliseconds(
          timesRef.current.connectionStartedAt,
          performance.now(),
        );
        setMetrics((current) => ({
          ...current,
          webRtcConnectionMs: duration,
        }));
        log(
          "WebRTC connected",
          duration === null ? undefined : `${Math.round(duration)} ms`,
        );
      } else if (status === "disconnected" || status === "disconnecting") {
        log(`WebRTC ${status}`);
      }
    },
    [log],
  );

  const recordUserSpeechStarted = useCallback(() => {
    log("User speech detected");
  }, [log]);

  const recordUserSpeechStopped = useCallback(() => {
    timesRef.current.speechStoppedAt = performance.now();
    log("User speech stopped");
  }, [log]);

  const recordUserTranscriptStarted = useCallback(() => {
    log("User transcript started");
  }, [log]);

  const recordUserTranscriptCompleted = useCallback(() => {
    log("User transcript completed");
  }, [log]);

  const recordResponseStarted = useCallback(
    (responseId: string) => {
      const startedAt = performance.now();
      timesRef.current.interruptionAt = null;
      timesRef.current.responses.set(responseId, { startedAt });
      setMetrics((current) => ({
        ...current,
        speechEndToResponseStartMs: elapsedMilliseconds(
          timesRef.current.speechStoppedAt,
          startedAt,
        ),
      }));
      log("AI response started");
    },
    [log],
  );

  const recordFirstTextDelta = useCallback(
    (responseId: string) => {
      const response = timesRef.current.responses.get(responseId);
      if (!response || response.firstTextAt !== undefined) {
        return;
      }

      const firstTextAt = performance.now();
      response.firstTextAt = firstTextAt;
      setMetrics((current) => ({
        ...current,
        speechEndToFirstTextDeltaMs: elapsedMilliseconds(
          timesRef.current.speechStoppedAt,
          firstTextAt,
        ),
      }));
      log("AI text generation started");
      log("First AI text delta received");
    },
    [log],
  );

  const recordFirstAudio = useCallback(
    (responseId: string) => {
      const response = timesRef.current.responses.get(responseId);
      if (!response || response.firstAudioAt !== undefined) {
        return;
      }

      const firstAudioAt = performance.now();
      response.firstAudioAt = firstAudioAt;
      setMetrics((current) => ({
        ...current,
        speechEndToFirstAudioMs: elapsedMilliseconds(
          timesRef.current.speechStoppedAt,
          firstAudioAt,
        ),
      }));
    },
    [],
  );

  const recordInterruption = useCallback(
    (event = "AI response interrupted") => {
    if (timesRef.current.interruptionAt !== null) {
      return;
    }
    timesRef.current.interruptionAt = performance.now();
    log(event);
    },
    [log],
  );

  const recordAudioStopped = useCallback(
    (event: string, playbackStopped = false) => {
      const stoppedAt = performance.now();
      const interruptionAt = timesRef.current.interruptionAt;
      if (playbackStopped && interruptionAt !== null) {
        const duration = elapsedMilliseconds(interruptionAt, stoppedAt);
        if (duration !== null) {
          setMetrics((current) => ({
            ...current,
            interruptionToAudioStopMs: duration,
          }));
          timesRef.current.interruptionAt = null;
        }
      }
      log(event);
    },
    [log],
  );

  const recordResponseCompleted = useCallback(
    (responseId: string, responseStatus: string | undefined) => {
      const response = timesRef.current.responses.get(responseId);
      const completedAt = performance.now();
      const duration = elapsedMilliseconds(response?.startedAt ?? null, completedAt);
      setMetrics((current) => ({
        ...current,
        totalResponseMs: duration,
      }));
      log(
        responseStatus === "cancelled"
          ? "AI response cancelled"
          : "AI response completed",
        duration === null ? responseStatus : `${Math.round(duration)} ms`,
      );
      timesRef.current.responses.delete(responseId);
    },
    [log],
  );

  const recordError = useCallback(
    (event: string, message: string) => {
      log(event, message);
    },
    [log],
  );

  const endConversation = useCallback(() => {
    log("Conversation ended");
  }, [log]);

  return {
    entries,
    metrics,
    paused,
    log,
    clearLogs,
    togglePaused,
    startConversation,
    beginCredentialRequest,
    finishCredentialRequest,
    beginWebRtcConnection,
    recordWebRtcStatus,
    recordUserSpeechStarted,
    recordUserSpeechStopped,
    recordUserTranscriptStarted,
    recordUserTranscriptCompleted,
    recordResponseStarted,
    recordFirstTextDelta,
    recordFirstAudio,
    recordInterruption,
    recordAudioStopped,
    recordResponseCompleted,
    recordError,
    endConversation,
  };
}
