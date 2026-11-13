"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";

import ConversationTranscript from "@/components/ConversationTranscript";
import SpeakButton from "@/components/SpeakButton";
import FinalScreen from "@/components/memes/FinalScreen";
import InitializationMeme from "@/components/memes/InitializationMeme";
import ReactionMeme from "@/components/memes/ReactionMeme";
import ShortlistingScreen from "@/components/memes/ShortlistingScreen";
import { useConversationTranscript } from "@/hooks/useConversationTranscript";
import { useLiveSessionEvents } from "@/hooks/useLiveSessionEvents";
import { useVoiceDiagnostics } from "@/hooks/useVoiceDiagnostics";
import { MemeAudioController } from "@/lib/MemeAudioController";
import type { BackendVoiceEvent } from "@/lib/types";
import { isSessionResponse } from "@/lib/types";

type VoiceStatus =
  | "idle"
  | "requesting_permission"
  | "initializing"
  | "connected"
  | "listening"
  | "speaking"
  | "ending"
  | "asking_shortlisting"
  | "happy_reaction"
  | "sad_reaction"
  | "finished"
  | "error";

type UnknownRecord = Record<string, unknown>;

const INITIAL_GREETING =
  "Hey! I'm Rohit.exe — Rohit's AI-powered digital portfolio. Think of me as the slightly more talkative version of his resume. I can walk you through the AI products he's built, the scale they operate at, and the impact they've made. What would you like to know?";
const INITIAL_AUDIO_TIMEOUT_MS = 20_000;
const REACTION_DISPLAY_DURATION_MS = 5_000;
const LIVE_SESSION_START_TIMEOUT_MS = 15_000;
const LIVE_SESSION_CLOSE_TIMEOUT_MS = 3_000;
const ICE_GATHERING_TIMEOUT_MS = 10_000;
interface RohitVoiceAgentProps {
  onConversationEnded: () => void;
}

function getBackendBaseUrl(): string | null {
  const configuredUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.trim();
  return configuredUrl ? configuredUrl.replace(/\/+$/, "") : null;
}

function classifyHttpFailure(status: number, detail: string): string {
  if (status === 404) return "route_not_found";
  if (status === 401 || status === 403) return "authentication_or_authorization";
  if (status === 422) return "invalid_request";
  if (status === 429) return "rate_limited";
  if (status === 500) return "backend_exception";
  if (status === 503 && /OPENAI_API_KEY/i.test(detail)) {
    return "backend_configuration";
  }
  if ((status === 502 || status === 503) && /timed out/i.test(detail)) {
    return "openai_timeout";
  }
  if ((status === 502 || status === 503) && /OpenAI GPT-Live API/i.test(detail)) {
    return "openai_session_creation_failure";
  }
  if (status === 502 || status === 503) return "upstream_or_infrastructure";
  return "http_error";
}

function safeErrorBodySummary(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!isRecord(parsed)) return "JSON error body omitted";
    const detail = parsed.detail;
    let summary: string;
    if (typeof detail === "string") {
      summary = detail;
    } else if (Array.isArray(detail)) {
      summary = JSON.stringify(
        detail.map((item) => {
          if (!isRecord(item)) return { type: "validation_error" };
          return {
            type: item.type,
            loc: item.loc,
            msg: item.msg,
          };
        }),
      );
    } else {
      summary = "Error body omitted";
    }
    return summary
      .replace(/sk-[A-Za-z0-9_-]+/gi, "[REDACTED]")
      .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
      .slice(0, 1000);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return "Non-JSON error body omitted";
    }
    throw error;
  }
}

function getErrorDetail(body: string, status: number): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (isRecord(parsed) && typeof parsed.detail === "string") {
      return parsed.detail;
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
  }
  return `Unable to create a GPT-Live session (HTTP ${status}).`;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function stopMicrophone(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function waitForLiveSessionStart(
  started: Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new Error("The voice connection was cancelled."));
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let abortHandler: (() => void) | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("GPT-Live did not confirm the session startup in time.")),
      LIVE_SESSION_START_TIMEOUT_MS,
    );
    abortHandler = () => reject(new Error("The voice connection was cancelled."));
    signal.addEventListener("abort", abortHandler, { once: true });
  });

  return Promise.race([started, timeout]).finally(() => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    if (abortHandler) {
      signal.removeEventListener("abort", abortHandler);
    }
  });
}

export default function RohitVoiceAgent({
  onConversationEnded,
}: RohitVoiceAgentProps) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [memeAudioError, setMemeAudioError] = useState("");
  const [audioPlaybackError, setAudioPlaybackError] = useState("");
  const [hasAssistantStartedSpeaking, setHasAssistantStartedSpeaking] =
    useState(false);
  const [shortlisted, setShortlisted] = useState(false);
  const remoteAudioElementRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioAnalysisFrameRef = useRef<number | null>(null);
  const remoteAudioIsPlayingRef = useRef(false);
  const remoteAudioHasNonSilentOutputRef = useRef(false);
  const sessionRef = useRef<string | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const sessionListenersCleanupRef = useRef<(() => void) | null>(null);
  const peerConnectionListenersCleanupRef = useRef<(() => void) | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const connectionRequestRef = useRef<AbortController | null>(null);
  const statusRef = useRef<VoiceStatus>("idle");
  const diagnosticSessionIdRef = useRef("unassigned");
  const pendingBackendEventsRef = useRef<
    Array<{
      event: BackendVoiceEvent;
      text?: string;
      durationMs?: number;
    }>
  >([]);
  const sessionStartedRef = useRef(false);
  const sessionCloseResolverRef = useRef<(() => void) | null>(null);
  const sessionCloseRequestedRef = useRef(false);
  const sessionErrorHandlerRef = useRef<(error: unknown) => void>(() => {});
  const backendEventSessionRef = useRef<{
    sessionId: string;
    eventToken: string;
    eventExpiresAt: number;
    startedAt: number;
  } | null>(null);
  const mountedRef = useRef(false);
  const firstAssistantAudioRef = useRef(false);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialAudioTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioControllerRef = useRef<MemeAudioController | null>(null);
  const transcript = useConversationTranscript();
  const diagnostics = useVoiceDiagnostics();
  const logBackendEvent = useCallback(
    (
      event: BackendVoiceEvent,
      text?: string,
      durationMs?: number,
    ) => {
      const session = backendEventSessionRef.current;
      if (!session) {
        pendingBackendEventsRef.current.push({ event, text, durationMs });
        return;
      }

      const backendUrl = getBackendBaseUrl();
      if (!backendUrl) {
        diagnostics.recordError(
          "Backend event logging error",
          "NEXT_PUBLIC_BACKEND_URL is not configured.",
        );
        return;
      }
      void fetch(`${backendUrl}/api/live/events`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.eventToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: session.sessionId,
          event_expires_at: session.eventExpiresAt,
          event,
          text,
          duration_ms: durationMs,
        }),
        keepalive: true,
      }).then(
        (response) => {
          if (!response.ok) {
            diagnostics.recordError(
              "Backend event logging error",
              `Event ${event} was rejected (HTTP ${response.status}).`,
            );
          }
        },
        (error: unknown) => {
          diagnostics.recordError(
            "Backend event logging error",
            error instanceof Error ? error.message : "Event forwarding failed.",
          );
        },
      );
    },
    [diagnostics.recordError],
  );
  const logDiagnostic = useCallback(
    (event: BackendVoiceEvent, detail?: string) => {
      const sessionId =
        backendEventSessionRef.current?.sessionId ??
        diagnosticSessionIdRef.current;
      let category = "LIVE";
      if (
        event.startsWith("audio.") ||
        event.startsWith("initialization.music.") ||
        event.startsWith("assistant.first_audio.")
      ) {
        category = "AUDIO";
      } else if (
        event.startsWith("ui.") ||
        event.startsWith("initialization.")
      ) {
        category = "UI";
      } else if (
        event.startsWith("voice.") ||
        event.startsWith("microphone.")
      ) {
        category = "VOICE";
      } else if (event.startsWith("webrtc.")) {
        category = "WEBRTC";
      }
      const message = `[${category}] ${new Date().toISOString()} [session=${sessionId}] ${event}${detail ? ` ${detail}` : ""}`;
      console.info(message);
      diagnostics.log(message);
      logBackendEvent(event);
    },
    [diagnostics.log, logBackendEvent],
  );
  const updateStatus = useCallback(
    (nextStatus: VoiceStatus) => {
      const previousStatus = statusRef.current;
      if (previousStatus === nextStatus) {
        return;
      }
      statusRef.current = nextStatus;
      setStatus(nextStatus);
      logDiagnostic("ui.initialization.changed", `${previousStatus} -> ${nextStatus}`);
      if (nextStatus === "initializing") {
        logDiagnostic("ui.cat.shown");
      }
    },
    [logDiagnostic],
  );
  const getAudioController = useCallback(() => {
    if (!audioControllerRef.current) {
      audioControllerRef.current = new MemeAudioController();
    }
    return audioControllerRef.current;
  }, []);
  const clearRemoteAudio = useCallback(() => {
    const audioElement = remoteAudioElementRef.current;
    if (audioElement) {
      audioElement.pause();
      audioElement.srcObject = null;
    }
  }, []);
  const clearInitialAudioTimer = useCallback(() => {
    if (initialAudioTimerRef.current !== null) {
      clearTimeout(initialAudioTimerRef.current);
      initialAudioTimerRef.current = null;
    }
  }, []);
  const clearAudioLevelMonitor = useCallback(() => {
    if (audioAnalysisFrameRef.current !== null) {
      cancelAnimationFrame(audioAnalysisFrameRef.current);
      audioAnalysisFrameRef.current = null;
    }
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    remoteAudioIsPlayingRef.current = false;
    remoteAudioHasNonSilentOutputRef.current = false;
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close().catch((error: unknown) => {
        logDiagnostic(
          "audio.analysis.close_failed",
          error instanceof Error ? error.message : "Unable to close AudioContext.",
        );
      });
    }
  }, [logDiagnostic]);
  const releaseLiveConnection = useCallback(
    (sendCloseEvent: boolean) => {
      const channel = dataChannelRef.current;
      if (
        sendCloseEvent &&
        sessionStartedRef.current &&
        channel?.readyState === "open" &&
        !sessionCloseRequestedRef.current
      ) {
        sessionCloseRequestedRef.current = true;
        channel.send(
          JSON.stringify({
            type: "session.close",
            event_id: crypto.randomUUID(),
          }),
        );
      }

      sessionRef.current = null;
      sessionStartedRef.current = false;
      sessionListenersCleanupRef.current?.();
      sessionListenersCleanupRef.current = null;
      peerConnectionListenersCleanupRef.current?.();
      peerConnectionListenersCleanupRef.current = null;
      if (channel && channel.readyState !== "closed") {
        channel.close();
      }
      dataChannelRef.current = null;
      peerConnectionRef.current?.close();
      peerConnectionRef.current = null;
      sessionCloseRequestedRef.current = false;
      clearAudioLevelMonitor();
      clearRemoteAudio();
      stopMicrophone(microphoneStreamRef.current);
      microphoneStreamRef.current = null;
    },
    [clearAudioLevelMonitor, clearRemoteAudio],
  );
  const playRemoteAudio = useCallback(async () => {
    const audioElement = remoteAudioElementRef.current;
    if (!audioElement || !audioElement.srcObject) {
      const message = "The AI audio stream has not arrived yet. Please retry once it connects.";
      setAudioPlaybackError(message);
      logDiagnostic("audio.element.play_error", "No remote stream is attached");
      return;
    }
    audioElement.autoplay = true;
    audioElement.muted = false;
    audioElement.volume = 1;
    try {
      await audioElement.play();
      logDiagnostic(
        "audio.element.play_resolved",
        `play() resolved; muted=${audioElement.muted}; volume=${audioElement.volume}`,
      );
      setAudioPlaybackError("");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown playback error";
      const message = `The browser blocked AI audio playback. Select Retry AI audio to allow sound. ${detail}`;
      setAudioPlaybackError(message);
      logDiagnostic("audio.element.play_error", detail);
    }
  }, [logDiagnostic]);
  const handleFirstAiAudioStarted = useCallback(() => {
    if (firstAssistantAudioRef.current) {
      return;
    }
    firstAssistantAudioRef.current = true;
    clearInitialAudioTimer();
    setHasAssistantStartedSpeaking(true);
    logDiagnostic("assistant.first_audio.playback_started");
    logDiagnostic("ui.cat.hide.triggered");
    logDiagnostic("ui.cat.hidden");
    logBackendEvent("audio.playback.started");
    logBackendEvent("ai.audio.playback_started");
    updateStatus("speaking");
    audioControllerRef.current?.stopMusic();
    logDiagnostic("initialization.music.stopped");
  }, [
    clearInitialAudioTimer,
    logBackendEvent,
    logDiagnostic,
    updateStatus,
  ]);
  const maybeHandleFirstAiAudioStarted = useCallback(() => {
    const audioElement = remoteAudioElementRef.current;
    if (
      !audioElement ||
      audioElement.paused ||
      audioElement.muted ||
      audioElement.volume === 0 ||
      !remoteAudioIsPlayingRef.current ||
      !remoteAudioHasNonSilentOutputRef.current
    ) {
      return;
    }
    handleFirstAiAudioStarted();
  }, [handleFirstAiAudioStarted]);
  const liveEvents = useLiveSessionEvents(
    transcript,
    diagnostics,
    updateStatus,
    logBackendEvent,
    logDiagnostic,
  );

  useEffect(() => {
    mountedRef.current = true;
    getAudioController().preloadAssets();
    const audioElement = remoteAudioElementRef.current;
    const onRemoteAudioError = () => {
      const code = audioElement?.error?.code;
      const message = `The AI audio element reported a playback error${code ? ` (media error ${code})` : ""}.`;
      setAudioPlaybackError(message);
      logDiagnostic("audio.element.play_error", message);
    };
    const onRemoteAudioPlaying = () => {
      remoteAudioIsPlayingRef.current = true;
      if (!firstAssistantAudioRef.current) {
        logDiagnostic("audio.element.playing");
      }
      maybeHandleFirstAiAudioStarted();
    };
    audioElement?.addEventListener("error", onRemoteAudioError);
    audioElement?.addEventListener("playing", onRemoteAudioPlaying);

    return () => {
      audioElement?.removeEventListener("error", onRemoteAudioError);
      audioElement?.removeEventListener("playing", onRemoteAudioPlaying);
      mountedRef.current = false;
      clearAudioLevelMonitor();
      const backendSession = backendEventSessionRef.current;
      if (backendSession) {
        logDiagnostic("initialization.music.stopped");
        logBackendEvent(
          "session.disconnected",
          undefined,
          performance.now() - backendSession.startedAt,
        );
        logBackendEvent("microphone.disconnected");
        backendEventSessionRef.current = null;
      }
      connectionRequestRef.current?.abort();
      connectionRequestRef.current = null;
      releaseLiveConnection(true);
      clearInitialAudioTimer();
      clearRemoteAudio();
      stopMicrophone(microphoneStreamRef.current);
      microphoneStreamRef.current = null;
      if (transitionTimerRef.current !== null) {
        clearTimeout(transitionTimerRef.current);
      }
      if (reactionTimerRef.current !== null) {
        clearTimeout(reactionTimerRef.current);
      }
      audioControllerRef.current?.stopMusic();
      audioControllerRef.current?.dispose();
      audioControllerRef.current = null;
    };
  }, [
    clearInitialAudioTimer,
    clearAudioLevelMonitor,
    clearRemoteAudio,
    getAudioController,
    maybeHandleFirstAiAudioStarted,
    releaseLiveConnection,
    logDiagnostic,
    logBackendEvent,
  ]);

  async function startConversation() {
    if (connectionRequestRef.current || sessionRef.current) {
      logDiagnostic("voice.button.clicked", "Ignored duplicate start request");
      return;
    }

    backendEventSessionRef.current = null;
    pendingBackendEventsRef.current = [];
    diagnosticSessionIdRef.current = `client-${crypto.randomUUID()}`;
    sessionStartedRef.current = false;
    sessionCloseRequestedRef.current = false;
    firstAssistantAudioRef.current = false;
    setHasAssistantStartedSpeaking(false);
    clearAudioLevelMonitor();
    remoteAudioIsPlayingRef.current = false;
    diagnostics.startConversation();
    logDiagnostic("voice.button.clicked");

    if (transitionTimerRef.current !== null) {
      clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
    if (reactionTimerRef.current !== null) {
      clearTimeout(reactionTimerRef.current);
      reactionTimerRef.current = null;
    }
    setMemeAudioError("");
    setAudioPlaybackError("");
    setShortlisted(false);
    getAudioController().stopAll();

    const connectionRequest = new AbortController();
    connectionRequestRef.current = connectionRequest;
    liveEvents.reset();
    transcript.clearTranscript();
    updateStatus("requesting_permission");
    setErrorMessage("");

    let microphoneStream: MediaStream | null = null;
    let failureCategory: "backend" | "microphone" | "openai" = "backend";
    let credentialRequestStarted = false;
    let credentialRequestFinished = false;
    let sessionErrorHandled = false;
    let resolveSessionStarted: (() => void) | null = null;
    let rejectSessionStarted: ((error: Error) => void) | null = null;
    const sessionStarted = new Promise<void>((resolve, reject) => {
      resolveSessionStarted = resolve;
      rejectSessionStarted = reject;
    });

    const handleSessionError = (error: unknown) => {
      if (
        sessionErrorHandled ||
        !mountedRef.current ||
        connectionRequest.signal.aborted ||
        connectionRequestRef.current !== connectionRequest
      ) {
        return;
      }
      sessionErrorHandled = true;
      const message = getConnectionErrorMessage(error);
      diagnostics.recordError("GPT-Live connection error", message);
      logBackendEvent(
        sessionRef.current ? "live.error" : "webrtc.failure",
        error instanceof Error ? error.name : undefined,
      );
      if (backendEventSessionRef.current) {
        logBackendEvent(
          "session.disconnected",
          undefined,
          performance.now() - backendEventSessionRef.current.startedAt,
        );
        logBackendEvent("microphone.disconnected");
        backendEventSessionRef.current = null;
      }
      getAudioController().stopAll();
      logDiagnostic("initialization.music.stopped");
      clearInitialAudioTimer();
      releaseLiveConnection(true);
      connectionRequestRef.current = null;
      diagnostics.endConversation();
      setErrorMessage(message);
      updateStatus("error");
    };
    sessionErrorHandlerRef.current = handleSessionError;

    try {
      diagnostics.log("Microphone permission requested");
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            "Microphone access is not available in this browser or page context.",
          );
        }
        microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (error) {
        failureCategory = "microphone";
        const message = getConnectionErrorMessage(error);
        if (isMicrophonePermissionDenied(error)) {
          diagnostics.log("Microphone permission denied", message);
        }
        diagnostics.recordError("Microphone error", message);
        throw error;
      }

      if (!mountedRef.current || connectionRequest.signal.aborted) {
        stopMicrophone(microphoneStream);
        return;
      }
      microphoneStreamRef.current = microphoneStream;
      diagnostics.log("Microphone permission granted");
      logDiagnostic("microphone.permission.granted");
      clearRemoteAudio();
      updateStatus("initializing");
      void getAudioController().startMusic((message) => {
        if (mountedRef.current) {
          setMemeAudioError(message);
          logDiagnostic("audio.playback.failure", message);
        }
      });

      const remoteAudioElement = remoteAudioElementRef.current;
      if (!remoteAudioElement) {
        throw new Error("The remote audio playback element is unavailable.");
      }
      remoteAudioElement.autoplay = true;
      remoteAudioElement.muted = false;
      remoteAudioElement.volume = 1;

      const peerConnection = new RTCPeerConnection();
      peerConnectionRef.current = peerConnection;
      logDiagnostic("webrtc.peer.created");
      diagnostics.beginWebRtcConnection();

      const peerConnectionCleanups: Array<() => void> = [];
      const onConnectionStateChange = () => {
        const connectionState = peerConnection.connectionState;
        logDiagnostic("webrtc.connection.state", connectionState);
        diagnostics.recordWebRtcStatus(
          connectionState === "connected"
            ? "connected"
            : connectionState === "disconnected" || connectionState === "failed" || connectionState === "closed"
              ? "disconnected"
              : "connecting",
        );
        if (connectionState === "failed") {
          handleSessionError(new Error("The GPT-Live WebRTC connection failed."));
        }
      };
      const onIceConnectionStateChange = () => {
        logDiagnostic("webrtc.ice.state", peerConnection.iceConnectionState);
      };
      const onRemoteTrack = (event: RTCTrackEvent) => {
        if (
          event.track.kind !== "audio" ||
          peerConnectionRef.current !== peerConnection ||
          connectionRequest.signal.aborted
        ) {
          return;
        }

        const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
        remoteAudioElement.srcObject = remoteStream;
        remoteAudioElement.muted = false;
        remoteAudioElement.volume = 1;
        remoteAudioElement.autoplay = true;
        logDiagnostic(
          "audio.remote_track.received",
          `enabled=${event.track.enabled}; muted=${event.track.muted}; readyState=${event.track.readyState}`,
        );
        logDiagnostic(
          "audio.element.attached",
          `tracks=${remoteStream.getAudioTracks().length}`,
        );

        clearAudioLevelMonitor();
        try {
          const audioContext = new AudioContext();
          audioContextRef.current = audioContext;
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 512;
          const source = audioContext.createMediaStreamSource(remoteStream);
          const silentGain = audioContext.createGain();
          silentGain.gain.value = 0;
          source.connect(analyser);
          analyser.connect(silentGain);
          silentGain.connect(audioContext.destination);

          const samples = new Float32Array(analyser.fftSize);
          let consecutiveAudibleFrames = 0;
          const analyzeRemoteAudio = () => {
            if (audioContextRef.current !== audioContext) {
              return;
            }
            if (firstAssistantAudioRef.current) {
              audioAnalysisFrameRef.current = null;
              return;
            }
            analyser.getFloatTimeDomainData(samples);
            let squaredSampleTotal = 0;
            for (const sample of samples) {
              squaredSampleTotal += sample * sample;
            }
            const rms = Math.sqrt(squaredSampleTotal / samples.length);
            consecutiveAudibleFrames =
              rms >= 0.01 ? consecutiveAudibleFrames + 1 : 0;
            if (
              consecutiveAudibleFrames >= 2 &&
              !remoteAudioHasNonSilentOutputRef.current
            ) {
              remoteAudioHasNonSilentOutputRef.current = true;
              logDiagnostic(
                "assistant.first_audio.received",
                `non-silent remote audio detected; rms=${rms.toFixed(4)}`,
              );
              maybeHandleFirstAiAudioStarted();
            }
            if (firstAssistantAudioRef.current) {
              audioAnalysisFrameRef.current = null;
              return;
            }
            audioAnalysisFrameRef.current =
              requestAnimationFrame(analyzeRemoteAudio);
          };
          audioAnalysisFrameRef.current =
            requestAnimationFrame(analyzeRemoteAudio);
          void audioContext.resume().then(
            () => logDiagnostic("audio.analysis.started"),
            (error: unknown) =>
              logDiagnostic(
                "audio.analysis.resume_failed",
                error instanceof Error ? error.message : "Unable to resume AudioContext.",
              ),
          );
          peerConnectionCleanups.push(clearAudioLevelMonitor);
        } catch (error) {
          clearAudioLevelMonitor();
          logDiagnostic(
            "audio.analysis.unavailable",
            error instanceof Error ? error.message : "Unable to monitor remote audio.",
          );
        }

        const onTrackMuted = () => logDiagnostic("audio.track.muted");
        const onTrackUnmuted = () => {
          if (peerConnectionRef.current !== peerConnection) {
            return;
          }
          logDiagnostic("audio.track.unmuted");
          void playRemoteAudio();
        };
        event.track.addEventListener("mute", onTrackMuted);
        event.track.addEventListener("unmute", onTrackUnmuted);
        peerConnectionCleanups.push(() => {
          event.track.removeEventListener("mute", onTrackMuted);
          event.track.removeEventListener("unmute", onTrackUnmuted);
        });
        void playRemoteAudio();
      };
      peerConnection.addEventListener("connectionstatechange", onConnectionStateChange);
      peerConnection.addEventListener("iceconnectionstatechange", onIceConnectionStateChange);
      peerConnection.addEventListener("track", onRemoteTrack);
      peerConnectionCleanups.push(() => {
        peerConnection.removeEventListener("connectionstatechange", onConnectionStateChange);
        peerConnection.removeEventListener("iceconnectionstatechange", onIceConnectionStateChange);
        peerConnection.removeEventListener("track", onRemoteTrack);
      });
      peerConnectionListenersCleanupRef.current = () => {
        for (const cleanup of peerConnectionCleanups.splice(0)) {
          cleanup();
        }
      };
      onConnectionStateChange();
      onIceConnectionStateChange();

      for (const track of microphoneStream.getAudioTracks()) {
        peerConnection.addTrack(track, microphoneStream);
      }
      const dataChannel = peerConnection.createDataChannel("oai-events");
      dataChannelRef.current = dataChannel;
      const onDataChannelOpen = () => logDiagnostic("webrtc.data_channel.opened");
      dataChannel.addEventListener("open", onDataChannelOpen);

      const onLiveSessionStarted = () => {
        if (sessionStartedRef.current || dataChannel.readyState !== "open") {
          return;
        }
        sessionStartedRef.current = true;
        updateStatus("connected");
        logBackendEvent("session.connected");
        logBackendEvent("live.session.started");
        try {
          dataChannel.send(
            JSON.stringify({
              type: "session.instructions.append",
              event_id: crypto.randomUUID(),
              delegation_id: null,
              content: `Immediately say the following opening exactly once, before responding to the caller: ${INITIAL_GREETING}`,
            }),
          );
          logBackendEvent("live.instructions.sent");
          initialAudioTimerRef.current = setTimeout(() => {
            initialAudioTimerRef.current = null;
            if (
              sessionRef.current &&
              !firstAssistantAudioRef.current
            ) {
              handleSessionError(
                new Error(
                  "GPT-Live connected, but no opening audio played. Check your audio output and try again.",
                ),
              );
            }
          }, INITIAL_AUDIO_TIMEOUT_MS);
          resolveSessionStarted?.();
        } catch (error) {
          const liveError = error instanceof Error ? error : new Error(String(error));
          rejectSessionStarted?.(liveError);
          handleSessionError(liveError);
        }
      };
      const cleanupLiveListeners = liveEvents.attachDataChannelListeners(
        dataChannel,
        () => peerConnectionRef.current === peerConnection,
        {
          onSessionStarted: onLiveSessionStarted,
          onSessionClosed: () => {
            sessionCloseResolverRef.current?.();
            if (!sessionCloseRequestedRef.current) {
              handleSessionError(new Error("GPT-Live closed the session unexpectedly."));
            }
          },
          onError: (error) => {
            rejectSessionStarted?.(error);
            handleSessionError(error);
          },
        },
      );
      sessionListenersCleanupRef.current = () => {
        dataChannel.removeEventListener("open", onDataChannelOpen);
        cleanupLiveListeners();
      };

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      if (peerConnection.iceGatheringState !== "complete") {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            cleanup();
            reject(new Error("Timed out while gathering WebRTC ICE candidates."));
          }, ICE_GATHERING_TIMEOUT_MS);
          const onAbort = () => {
            cleanup();
            reject(new Error("The voice connection was cancelled."));
          };
          const onIceGatheringStateChange = () => {
            if (peerConnection.iceGatheringState === "complete") {
              cleanup();
              resolve();
            }
          };
          const cleanup = () => {
            clearTimeout(timeout);
            connectionRequest.signal.removeEventListener("abort", onAbort);
            peerConnection.removeEventListener(
              "icegatheringstatechange",
              onIceGatheringStateChange,
            );
          };
          connectionRequest.signal.addEventListener("abort", onAbort, { once: true });
          peerConnection.addEventListener(
            "icegatheringstatechange",
            onIceGatheringStateChange,
          );
          onIceGatheringStateChange();
        });
      }
      if (connectionRequest.signal.aborted) {
        return;
      }
      const sdpOffer = peerConnection.localDescription?.sdp;
      if (!sdpOffer) {
        throw new Error("The browser did not produce a WebRTC SDP offer.");
      }

      logDiagnostic("voice.session.creation.started");
      diagnostics.beginCredentialRequest();
      credentialRequestStarted = true;
      const backendUrl = getBackendBaseUrl();
      if (!backendUrl) {
        throw new Error("NEXT_PUBLIC_BACKEND_URL is not configured.");
      }
      const requestPath = "/api/live/session";
      const requestUrl = `${backendUrl}${requestPath}`;
      const clientSessionId = diagnosticSessionIdRef.current;
      const requestId = crypto.randomUUID();
      const requestTimestamp = new Date().toISOString();
      const requestStartedAt = performance.now();
      console.info("[VOICE API] session request started", {
        clientSessionId,
        requestId,
        apiBaseUrl: backendUrl,
        requestPath,
        requestUrl,
        requestTimestamp,
      });
      let response: Response;
      try {
        response = await fetch(
          requestUrl,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Request-ID": requestId,
            },
            body: JSON.stringify({ sdp: sdpOffer }),
            signal: connectionRequest.signal,
            cache: "no-store",
          },
        );
      } catch (error) {
        if (connectionRequest.signal.aborted) {
          return;
        }
        const category =
          error instanceof Error && error.name === "TimeoutError"
            ? "timeout"
            : "network_error";
        console.error("[VOICE API] session request failed", {
          clientSessionId,
          requestId,
          apiBaseUrl: backendUrl,
          requestPath,
          requestUrl,
          requestTimestamp,
          durationMs: performance.now() - requestStartedAt,
          httpStatus: null,
          responseContentType: null,
          responseBody: "Response unavailable.",
          category,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        diagnostics.finishCredentialRequest(false);
        credentialRequestFinished = true;
        diagnostics.recordError("Backend error", "Could not reach the Rohit.exe API.");
        throw new Error(
          "Couldn't reach the Rohit.exe API. Check your internet connection and try again.",
          { cause: error },
        );
      }

      if (!response.ok) {
        const responseBody = await response.text();
        const bodySummary = safeErrorBodySummary(responseBody);
        const detail = getErrorDetail(responseBody, response.status);
        const category = classifyHttpFailure(response.status, detail);
        console.error("[VOICE API] session request rejected", {
          clientSessionId,
          requestId,
          apiBaseUrl: backendUrl,
          requestPath,
          requestUrl,
          requestTimestamp,
          durationMs: performance.now() - requestStartedAt,
          httpStatus: response.status,
          category,
          responseContentType: response.headers.get("content-type"),
          responseBody: bodySummary,
        });
        diagnostics.recordError("Backend error", detail);
        throw new Error(detail);
      }

      console.info("[VOICE API] session request completed", {
        clientSessionId,
        requestId,
        apiBaseUrl: backendUrl,
        requestPath,
        requestUrl,
        requestTimestamp,
        durationMs: performance.now() - requestStartedAt,
        httpStatus: response.status,
        responseContentType: response.headers.get("content-type"),
        responseBody: "Session response omitted; contains SDP and event credentials.",
      });

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new Error("The backend returned an invalid GPT-Live session response.");
      }
      if (!isSessionResponse(data)) {
        throw new Error("The backend returned an invalid GPT-Live session response.");
      }

      console.log("SESSION RESPONSE:", {
        success: data.success,
        hasSdp: Boolean(data.sdp),
        hasSessionId: !!data.session_id,
        hasEventToken: !!data.event_token,
      });

      diagnostics.finishCredentialRequest(true);
      credentialRequestFinished = true;
      sessionRef.current = data.session_id;
      backendEventSessionRef.current = {
        sessionId: data.session_id,
        eventToken: data.event_token,
        eventExpiresAt: data.event_expires_at,
        startedAt: performance.now(),
      };
      diagnosticSessionIdRef.current = data.session_id;
      for (const queuedEvent of pendingBackendEventsRef.current.splice(0)) {
        logBackendEvent(queuedEvent.event, queuedEvent.text, queuedEvent.durationMs);
      }
      logDiagnostic("voice.session.creation.completed");
      logBackendEvent("live.session.created");
      logBackendEvent("microphone.connected");
      failureCategory = "openai";

      await peerConnection.setRemoteDescription({
        type: "answer",
        sdp: data.sdp,
      });
      await waitForLiveSessionStart(sessionStarted, connectionRequest.signal);
    } catch (error) {
      clearInitialAudioTimer();
      liveEvents.finalizeAssistantTurn("interrupted");
      liveEvents.finalizeUserTurn();
      if (connectionRequestRef.current === connectionRequest) {
        if (backendEventSessionRef.current) {
          logBackendEvent(
            "session.disconnected",
            undefined,
            performance.now() - backendEventSessionRef.current.startedAt,
          );
          logBackendEvent("microphone.disconnected");
          backendEventSessionRef.current = null;
        }
        releaseLiveConnection(true);
        getAudioController().stopAll();
        logDiagnostic("initialization.music.stopped");
        pendingBackendEventsRef.current = [];
        if (credentialRequestStarted && !credentialRequestFinished) {
          diagnostics.finishCredentialRequest(false);
        }
        if (mountedRef.current && !connectionRequest.signal.aborted) {
          logBackendEvent(
            failureCategory === "backend" ? "api.failure" : "webrtc.failure",
            error instanceof Error ? error.name : undefined,
          );
          const message = getConnectionErrorMessage(error);
          if (failureCategory === "openai") {
            diagnostics.recordError("GPT-Live connection error", message);
          }
          diagnostics.endConversation();
          setErrorMessage(message);
          updateStatus("error");
        } else if (connectionRequest.signal.aborted) {
          updateStatus("idle");
        }
      } else {
        stopMicrophone(microphoneStream);
      }
    } finally {
      sessionErrorHandlerRef.current = () => {};
      if (connectionRequestRef.current === connectionRequest) {
        connectionRequestRef.current = null;
      }
    }
  }

  async function stopConversation() {
    if (statusRef.current === "ending") {
      return;
    }

    const shouldAskShortlisting =
      statusRef.current !== "initializing" &&
      statusRef.current !== "requesting_permission" &&
      sessionStartedRef.current;
    clearInitialAudioTimer();
    connectionRequestRef.current?.abort();
    connectionRequestRef.current = null;
    getAudioController().stopAll();
    logDiagnostic("initialization.music.stopped");

    if (shouldAskShortlisting) {
      updateStatus("ending");
      const channel = dataChannelRef.current;
      if (channel?.readyState === "open" && !sessionCloseRequestedRef.current) {
        sessionCloseRequestedRef.current = true;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const closed = new Promise<boolean>((resolve) => {
          sessionCloseResolverRef.current = () => resolve(true);
          timeoutId = setTimeout(
            () => resolve(false),
            LIVE_SESSION_CLOSE_TIMEOUT_MS,
          );
        });
        try {
          channel.send(
            JSON.stringify({
              type: "session.close",
              event_id: crypto.randomUUID(),
            }),
          );
          const confirmed = await closed;
          if (!confirmed) {
            diagnostics.recordError(
              "GPT-Live close unconfirmed",
              "The session did not confirm closure before the timeout.",
            );
          }
        } catch (error) {
          diagnostics.recordError(
            "GPT-Live close error",
            error instanceof Error ? error.message : "Could not send session.close.",
          );
        } finally {
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
          }
          sessionCloseResolverRef.current = null;
        }
      }
    }

    if (backendEventSessionRef.current) {
      logBackendEvent(
        "session.disconnected",
        undefined,
        performance.now() - backendEventSessionRef.current.startedAt,
      );
      logBackendEvent("microphone.disconnected");
      backendEventSessionRef.current = null;
    }
    releaseLiveConnection(false);
    diagnostics.endConversation();
    if (!shouldAskShortlisting) {
      updateStatus("idle");
      return;
    }

    transitionTimerRef.current = setTimeout(() => {
      transitionTimerRef.current = null;
      if (mountedRef.current) {
        updateStatus("asking_shortlisting");
      }
    }, 250);
  }

  function chooseShortlisting(shortlisted: boolean) {
    setShortlisted(shortlisted);
    setMemeAudioError("");
    updateStatus(shortlisted ? "happy_reaction" : "sad_reaction");
    void getAudioController().playReaction(
      shortlisted ? "happy-cat" : "cooked-dog",
      (message) => {
        if (mountedRef.current) {
          setMemeAudioError(message);
        }
      },
    );
    reactionTimerRef.current = setTimeout(() => {
      reactionTimerRef.current = null;
      if (mountedRef.current) {
        getAudioController().stopAll();
        updateStatus("finished");
        onConversationEnded();
      }
    }, REACTION_DISPLAY_DURATION_MS);
  }

  function replayConversation() {
    getAudioController().stopAll();
    liveEvents.reset();
    updateStatus("idle");
    void startConversation();
  }

  function backToPortfolio() {
    if (reactionTimerRef.current !== null) {
      clearTimeout(reactionTimerRef.current);
      reactionTimerRef.current = null;
    }
    getAudioController().stopAll();
    clearRemoteAudio();
    updateStatus("idle");
    setShortlisted(false);
    firstAssistantAudioRef.current = false;
    setHasAssistantStartedSpeaking(false);
    transcript.clearTranscript();
  }

  const isActive = [
    "requesting_permission",
    "initializing",
    "connected",
    "listening",
    "speaking",
    "ending",
  ].includes(status);
  const isInitializationMemeVisible =
    !hasAssistantStartedSpeaking &&
    ["initializing", "connected", "listening", "speaking"].includes(status);
  return (
    <>
      <audio
        ref={remoteAudioElementRef}
        autoPlay
        playsInline
        className="fixed h-px w-px opacity-0 pointer-events-none"
        aria-hidden="true"
      />
      <div className="flex w-full flex-col items-center gap-6" aria-live="polite">
        <ConversationTranscript messages={transcript.messages} />

        {isActive ? (
          <SpeakButton
            active
            onClick={stopConversation}
            disabled={status === "ending"}
            label={
              status === "initializing" || status === "requesting_permission"
                ? "Cancel connection"
                : status === "ending"
                  ? "Ending conversation..."
                  : "End conversation"
            }
          />
        ) : (
          <SpeakButton
            active={false}
            onClick={startConversation}
            label="Speak to Rohit.exe"
          />
        )}

        {status === "error" && (
          <>
            <p role="alert" className="voice-error text-center">
              {errorMessage}
            </p>
            <button
              type="button"
              onClick={() => void startConversation()}
              className="retry-button"
            >
              Retry voice connection
            </button>
          </>
        )}
      </div>

      <AnimatePresence>
        {isInitializationMemeVisible && (
          <InitializationMeme
            key="initialization"
            audioError={audioPlaybackError || memeAudioError}
            canRetryAudio={audioPlaybackError !== ""}
            onRetryAudio={() => void playRemoteAudio()}
          />
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {status === "asking_shortlisting" ? (
          <ShortlistingScreen
            key="shortlisting"
            onAnswer={chooseShortlisting}
          />
        ) : status === "happy_reaction" || status === "sad_reaction" ? (
          <ReactionMeme
            key="reaction"
            shortlisted={shortlisted}
            audioError={memeAudioError}
          />
        ) : status === "finished" ? (
          <FinalScreen
            key="finished"
            onReplay={replayConversation}
            onBack={backToPortfolio}
          />
        ) : null}
      </AnimatePresence>
    </>
  );
}

function isMicrophonePermissionDenied(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "NotAllowedError" ||
      error.name === "PermissionDeniedError")
  );
}

function getConnectionErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (isMicrophonePermissionDenied(error)) {
      return "Microphone access was denied. Allow microphone access in your browser settings, then try again.";
    }
    if (error.name === "NotFoundError") {
      return "No microphone was found. Connect a microphone and try again.";
    }
    if (error.name === "SecurityError") {
      return "Microphone access requires a secure page. Use localhost or HTTPS.";
    }
  }

  if (
    isRecord(error) &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return error instanceof Error
    ? error.message
    : "Unable to connect to the voice service. Please try again.";
}
