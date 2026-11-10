"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { tool } from "@openai/agents";
import {
  OpenAIRealtimeWebRTC,
  RealtimeAgent,
  RealtimeSession,
} from "@openai/agents/realtime";

import ConversationTranscript from "@/components/ConversationTranscript";
import SpeakButton from "@/components/SpeakButton";
import FinalScreen from "@/components/memes/FinalScreen";
import InitializationMeme from "@/components/memes/InitializationMeme";
import ReactionMeme from "@/components/memes/ReactionMeme";
import ShortlistingScreen from "@/components/memes/ShortlistingScreen";
import { useConversationTranscript } from "@/hooks/useConversationTranscript";
import { useRealtimeSessionEvents } from "@/hooks/useRealtimeSessionEvents";
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
  "Hey there! I'm Rohit.exe. Think of me as Rohit's digital representative. You can ask me about his engineering experience, AI projects, technical skills, or anything else you'd like to explore. So, what are we curious about today?";
const INITIAL_AUDIO_TIMEOUT_MS = 20_000;
const REACTION_DISPLAY_DURATION_MS = 5_000;
const SESSION_CONFIGURATION_ACK_TIMEOUT_MS = 2_000;
const SESSION_CONFIGURATION_ACK_ERROR =
  "Realtime session configuration was not acknowledged by the server.";
interface RohitVoiceAgentProps {
  onConversationEnded: () => void;
  onOpenContact: () => void;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function stopMicrophone(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function waitForSessionConfigurationAcknowledgement(
  acknowledgement: Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new Error("The voice connection was cancelled."));
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let abortHandler: (() => void) | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(SESSION_CONFIGURATION_ACK_ERROR)),
      SESSION_CONFIGURATION_ACK_TIMEOUT_MS,
    );
    abortHandler = () => reject(new Error("The voice connection was cancelled."));
    signal.addEventListener("abort", abortHandler, { once: true });
  });

  return Promise.race([acknowledgement, timeout]).finally(() => {
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
  onOpenContact,
}: RohitVoiceAgentProps) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [memeAudioError, setMemeAudioError] = useState("");
  const [audioPlaybackError, setAudioPlaybackError] = useState("");
  const [shortlisted, setShortlisted] = useState(false);
  const remoteAudioElementRef = useRef<HTMLAudioElement>(null);
  const sessionRef = useRef<RealtimeSession | null>(null);
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
  const sessionConfigurationConfirmedRef = useRef(false);
  const sessionConfigurationResolveRef = useRef<(() => void) | null>(null);
  const backendEventSessionRef = useRef<{
    sessionId: string;
    eventToken: string;
    eventExpiresAt: number;
    startedAt: number;
  } | null>(null);
  const mountedRef = useRef(false);
  const initialGreetingTriggeredRef = useRef(false);
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

   const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "");

if (!backendUrl) {
  diagnostics.recordError(
    "Backend event logging error",
    "NEXT_PUBLIC_BACKEND_URL is not configured."
  );
  return;
}

fetch(`${backendUrl}/api/realtime/events`, {
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
      const category = event.startsWith("audio.")
        ? "AUDIO"
        : event.startsWith("initialization.music.")
          ? "AUDIO"
        : event.startsWith("ui.") || event.startsWith("initialization.")
          ? "UI"
          : event.startsWith("voice.") || event.startsWith("microphone.")
            ? "VOICE"
            : event.startsWith("webrtc.")
              ? "WEBRTC"
              : "REALTIME";
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
      } else if (previousStatus === "initializing") {
        logDiagnostic("ui.cat.hidden");
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
    microphoneStreamRef.current
      ?.getAudioTracks()
      .forEach((track) => (track.enabled = true));
    sessionRef.current?.mute(false);
    updateStatus("speaking");
    audioControllerRef.current?.stopMusic();
    logDiagnostic("initialization.music.stopped");
  }, [clearInitialAudioTimer, logDiagnostic, updateStatus]);
  const onInitialGreetingFinished = useCallback(() => {
    microphoneStreamRef.current
      ?.getAudioTracks()
      .forEach((track) => (track.enabled = true));
    sessionRef.current?.mute(false);
    updateStatus("listening");
  }, [updateStatus]);
  const onSessionConfigured = useCallback(() => {
    sessionConfigurationConfirmedRef.current = true;
    sessionConfigurationResolveRef.current?.();
    sessionConfigurationResolveRef.current = null;
  }, []);
  const realtimeEvents = useRealtimeSessionEvents(
    transcript,
    diagnostics,
    updateStatus,
    handleFirstAiAudioStarted,
    onInitialGreetingFinished,
    onSessionConfigured,
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
    audioElement?.addEventListener("error", onRemoteAudioError);

    return () => {
      audioElement?.removeEventListener("error", onRemoteAudioError);
      mountedRef.current = false;
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
      sessionListenersCleanupRef.current?.();
      sessionListenersCleanupRef.current = null;
      peerConnectionListenersCleanupRef.current?.();
      peerConnectionListenersCleanupRef.current = null;
      sessionRef.current?.close();
      sessionRef.current = null;
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
    clearRemoteAudio,
    getAudioController,
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
    initialGreetingTriggeredRef.current = false;
    firstAssistantAudioRef.current = false;
    sessionConfigurationConfirmedRef.current = false;
    sessionConfigurationResolveRef.current = null;
    setMemeAudioError("");
    setAudioPlaybackError("");
    setShortlisted(false);
    const audioController = getAudioController();
    audioController.stopAll();

    const connectionRequest = new AbortController();
    connectionRequestRef.current = connectionRequest;
    realtimeEvents.reset();
    transcript.clearTranscript();
    updateStatus("requesting_permission");
    setErrorMessage("");

    let session: RealtimeSession | null = null;
    let credentialRequestFinished = false;
    let credentialRequestStarted = false;
    let failureCategory: "backend" | "microphone" | "openai" | null = null;
    let microphoneStream: MediaStream | null = null;
    let sessionConfigurationAcknowledgement: Promise<void> | null = null;

    try {
      diagnostics.log("Microphone permission requested");
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            "Microphone access is not available in this browser or page context.",
          );
        }
        microphoneStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
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
      void audioController.startMusic((message) => {
        if (mountedRef.current) {
          setMemeAudioError(message);
          logDiagnostic("audio.playback.failure", message);
        }
      });

      logDiagnostic("voice.session.creation.started");
      diagnostics.beginCredentialRequest();
      credentialRequestStarted = true;

    
let response: Response;

try {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;

  if (!backendUrl) {
    throw new Error(
      "NEXT_PUBLIC_BACKEND_URL is not configured."
    );
  }

  response = await fetch(
    `${backendUrl.replace(/\/$/, "")}/api/realtime/session`,
    {
      method: "POST",
    }
  );

  console.log("Backend URL:", backendUrl);
  console.log("Session API status:", response.status);

} catch (error) {
  failureCategory = "backend";
  diagnostics.finishCredentialRequest(false);
  credentialRequestFinished = true;

  if (connectionRequest.signal.aborted) {
    return;
  }

  diagnostics.recordError(
    "Backend error",
    error instanceof Error ? error.message : "Unknown backend error"
  );

  throw new Error(
    "Couldn't reach the Rohit.exe API. Check your backend URL and internet connection.",
    { cause: error }
  );
}

      if (!mountedRef.current || connectionRequest.signal.aborted) {
        diagnostics.finishCredentialRequest(false);
        credentialRequestFinished = true;
        return;
      }

      if (!response.ok) {
        failureCategory = "backend";
        diagnostics.finishCredentialRequest(false);
        credentialRequestFinished = true;
        let detail = `Unable to create a voice session (HTTP ${response.status}).`;
        try {
          const errorBody: unknown = await response.json();
          if (
            isRecord(errorBody) &&
            typeof errorBody.detail === "string"
          ) {
            detail = errorBody.detail;
          }
        } catch {
          // Keep the HTTP status message when the backend response is not JSON.
        }
        diagnostics.recordError("Backend error", detail);
        throw new Error(detail);
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        failureCategory = "backend";
        diagnostics.finishCredentialRequest(false);
        credentialRequestFinished = true;
        diagnostics.recordError(
          "Backend error",
          "The backend returned an invalid voice session response.",
        );
        throw new Error("The backend returned an invalid voice session response.");
      }
      if (!mountedRef.current || connectionRequest.signal.aborted) {
        diagnostics.finishCredentialRequest(false);
        credentialRequestFinished = true;
        return;
      }
      if (!isSessionResponse(data)) {
        failureCategory = "backend";
        diagnostics.finishCredentialRequest(false);
        credentialRequestFinished = true;
        diagnostics.recordError(
          "Backend error",
          "The backend returned an invalid voice session response.",
        );
        throw new Error("The backend returned an invalid voice session response.");
      }

      console.log("SESSION RESPONSE:", {
        success: data.success,
        hasClientSecret: !!data.client_secret,
        hasInstructions: !!data.instructions,
        hasSessionId: !!data.session_id,
        hasEventToken: !!data.event_token,
      });

      diagnostics.finishCredentialRequest(true);
      credentialRequestFinished = true;
      backendEventSessionRef.current = {
        sessionId: data.session_id,
        eventToken: data.event_token,
        eventExpiresAt: data.event_expires_at,
        startedAt: performance.now(),
      };
      diagnosticSessionIdRef.current = data.session_id;
      for (const queuedEvent of pendingBackendEventsRef.current.splice(0)) {
        logBackendEvent(
          queuedEvent.event,
          queuedEvent.text,
          queuedEvent.durationMs,
        );
      }
      logDiagnostic("voice.session.creation.completed");
      logBackendEvent("microphone.connected");
      microphoneStream
        .getAudioTracks()
        .forEach((track) => (track.enabled = false));

      failureCategory = "openai";
      const openContactTool = tool({
        name: "open_contact_form",
        description:
          "Open Rohit's contact options when the user asks how to contact him, send a message, or schedule a meeting. This only opens the contact interface; never send a message or book a meeting.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        execute: async () => {
          onOpenContact();
          return "Contact options are open. The user must choose and submit any message or booking themselves.";
        },
      });
      const agent = new RealtimeAgent({
        name: "Rohit.exe",
        instructions: data.instructions,
        voice: "marin",
        tools: [openContactTool],
      });
      const remoteAudioElement = remoteAudioElementRef.current;
      if (!remoteAudioElement) {
        throw new Error("The remote audio playback element is unavailable.");
      }
      remoteAudioElement.autoplay = true;
      remoteAudioElement.muted = false;
      remoteAudioElement.volume = 1;
      const peerConnectionListenerCleanups: Array<() => void> = [];
      const webRtcTransport = new OpenAIRealtimeWebRTC({
        mediaStream: microphoneStream,
        audioElement: remoteAudioElement,
        changePeerConnection: (peerConnection) => {
          logDiagnostic("webrtc.peer.created");
          const onConnectionStateChange = () => {
            logDiagnostic(
              "webrtc.connection.state",
              peerConnection.connectionState,
            );
          };
          const onIceConnectionStateChange = () => {
            logDiagnostic(
              "webrtc.ice.state",
              peerConnection.iceConnectionState,
            );
          };
          const onRemoteTrack = (event: RTCTrackEvent) => {
            if (
              event.track.kind !== "audio" ||
              sessionRef.current !== session ||
              connectionRequest.signal.aborted
            ) {
              return;
            }
            const remoteStream =
              event.streams[0] ?? new MediaStream([event.track]);
            if (remoteAudioElement.srcObject !== remoteStream) {
              remoteAudioElement.srcObject = remoteStream;
            }
            remoteAudioElement.muted = false;
            remoteAudioElement.volume = 1;
            remoteAudioElement.autoplay = true;
            if (!event.track.enabled) {
              event.track.enabled = true;
            }
            logDiagnostic(
              "audio.remote_track.received",
              `kind=${event.track.kind}; enabled=${event.track.enabled}; muted=${event.track.muted}; readyState=${event.track.readyState}`,
            );
            logDiagnostic(
              "audio.element.attached",
              `tracks=${remoteStream.getAudioTracks().length}; muted=${remoteAudioElement.muted}; volume=${remoteAudioElement.volume}`,
            );
            const onTrackMuted = () => {
              logDiagnostic("audio.track.muted");
            };
            const onTrackUnmuted = () => {
              if (sessionRef.current !== session) {
                return;
              }
              logDiagnostic(
                "audio.track.unmuted",
                `enabled=${event.track.enabled}; readyState=${event.track.readyState}`,
              );
              realtimeEvents.notifyRemoteAudioTrackUnmuted();
              void playRemoteAudio();
            };
            event.track.addEventListener("mute", onTrackMuted);
            event.track.addEventListener("unmute", onTrackUnmuted);
            peerConnectionListenerCleanups.push(() => {
              event.track.removeEventListener("mute", onTrackMuted);
              event.track.removeEventListener("unmute", onTrackUnmuted);
            });
            void playRemoteAudio();
          };
          peerConnection.addEventListener(
            "connectionstatechange",
            onConnectionStateChange,
          );
          peerConnection.addEventListener(
            "iceconnectionstatechange",
            onIceConnectionStateChange,
          );
          peerConnection.addEventListener("track", onRemoteTrack);
          peerConnectionListenerCleanups.push(() => {
            peerConnection.removeEventListener(
              "connectionstatechange",
              onConnectionStateChange,
            );
            peerConnection.removeEventListener(
              "iceconnectionstatechange",
              onIceConnectionStateChange,
            );
            peerConnection.removeEventListener("track", onRemoteTrack);
          });
          peerConnectionListenersCleanupRef.current = () => {
            for (const cleanup of peerConnectionListenerCleanups.splice(0)) {
              cleanup();
            }
          };
          onConnectionStateChange();
          onIceConnectionStateChange();
          return peerConnection;
        },
      });
      session = new RealtimeSession(agent, {
        model: "gpt-realtime-2.1",
        transport: webRtcTransport,
      });
      sessionRef.current = session;
      logDiagnostic("realtime.session.created");
      sessionConfigurationAcknowledgement = new Promise<void>((resolve) => {
        sessionConfigurationResolveRef.current = resolve;
      });

      const activeSession = session;
      let sessionErrorHandled = false;
      const onSessionError = (error: unknown) => {
        if (sessionErrorHandled || sessionRef.current !== activeSession) {
          return;
        }
        sessionErrorHandled = true;
        const message = getConnectionErrorMessage(error);
        diagnostics.recordError("Realtime session error", message);
        logBackendEvent(
          "webrtc.failure",
          error instanceof Error ? error.name : undefined,
        );
        const backendSession = backendEventSessionRef.current;
        if (backendSession) {
          logBackendEvent(
            "session.disconnected",
            undefined,
            performance.now() - backendSession.startedAt,
          );
          logBackendEvent("microphone.disconnected");
        }
        getAudioController().stopAll();
        logDiagnostic("initialization.music.stopped");
        backendEventSessionRef.current = null;
        clearInitialAudioTimer();
        sessionListenersCleanupRef.current?.();
        sessionListenersCleanupRef.current = null;
        peerConnectionListenersCleanupRef.current?.();
        peerConnectionListenersCleanupRef.current = null;
        activeSession.close();
        sessionRef.current = null;
        clearRemoteAudio();
        stopMicrophone(microphoneStreamRef.current);
        microphoneStreamRef.current = null;
        connectionRequestRef.current?.abort();
        connectionRequestRef.current = null;
        setErrorMessage(message);
        updateStatus("error");
      };
      sessionListenersCleanupRef.current = realtimeEvents.attachSessionListeners(
        activeSession,
        () =>
          mountedRef.current &&
          sessionRef.current === activeSession &&
          !connectionRequest.signal.aborted,
        onSessionError,
        remoteAudioElement,
      );

      diagnostics.beginWebRtcConnection();
      logDiagnostic("realtime.session.config.sent");
      console.log("Starting Realtime WebRTC connection...");
      await activeSession.connect({ apiKey: data.client_secret });
      console.log("Realtime WebRTC connection established.");
      if (
        mountedRef.current &&
        !connectionRequest.signal.aborted &&
        sessionRef.current === session
      ) {
        if (
          !sessionConfigurationConfirmedRef.current &&
          sessionConfigurationAcknowledgement
        ) {
          await waitForSessionConfigurationAcknowledgement(
            sessionConfigurationAcknowledgement,
            connectionRequest.signal,
          );
        }
        if (
          webRtcTransport.connectionState.dataChannel?.readyState !== "open"
        ) {
          throw new Error("Realtime data channel did not open.");
        }
        if (!sessionConfigurationConfirmedRef.current) {
          throw new Error(SESSION_CONFIGURATION_ACK_ERROR);
        }
        if (!firstAssistantAudioRef.current) {
          if (!initialGreetingTriggeredRef.current) {
            initialGreetingTriggeredRef.current = true;
            diagnostics.log("Requesting the initial spoken greeting");
            logDiagnostic("realtime.response.create.sent");
            clearInitialAudioTimer();
            initialAudioTimerRef.current = setTimeout(() => {
              initialAudioTimerRef.current = null;
              if (
                sessionRef.current === activeSession &&
                !firstAssistantAudioRef.current
              ) {
                logDiagnostic(
                  "audio.element.play_error",
                  "No actual remote audio playback within 20 seconds",
                );
                onSessionError(
                  new Error(
                    "The AI response was requested, but no audible audio playback arrived. Check your audio output and retry.",
                  ),
                );
              }
            }, INITIAL_AUDIO_TIMEOUT_MS);
            activeSession.transport.sendEvent({
              type: "response.create",
              response: {
                instructions: `Say exactly this introduction, without adding or omitting any words: "${INITIAL_GREETING}"`,
                output_modalities: ["audio"],
              },
            });
          }
        }
      }
    } catch (error) {
      sessionConfigurationResolveRef.current = null;
      clearInitialAudioTimer();
      sessionListenersCleanupRef.current?.();
      sessionListenersCleanupRef.current = null;
      peerConnectionListenersCleanupRef.current?.();
      peerConnectionListenersCleanupRef.current = null;
      session?.close();
      if (sessionRef.current === session) {
        sessionRef.current = null;
      }
      clearRemoteAudio();
      stopMicrophone(microphoneStream ?? microphoneStreamRef.current);
      microphoneStreamRef.current = null;
      getAudioController().stopAll();
      logDiagnostic("initialization.music.stopped");
      pendingBackendEventsRef.current = [];

      if (mountedRef.current && !connectionRequest.signal.aborted) {
        logBackendEvent(
          failureCategory === "backend" ? "api.failure" : "webrtc.failure",
          error instanceof Error ? error.name : undefined,
        );
        if (backendEventSessionRef.current) {
          logBackendEvent(
            "session.disconnected",
            undefined,
            performance.now() - backendEventSessionRef.current.startedAt,
          );
          backendEventSessionRef.current = null;
        }
        if (credentialRequestStarted && !credentialRequestFinished) {
          diagnostics.finishCredentialRequest(false);
        }
        const message = getConnectionErrorMessage(error);
        if (failureCategory === "openai") {
          diagnostics.recordError("OpenAI connection error", message);
        }
        setErrorMessage(message);
        updateStatus("error");
      }
    } finally {
      sessionConfigurationResolveRef.current = null;
      if (connectionRequestRef.current === connectionRequest) {
        connectionRequestRef.current = null;
      }
    }
  }

  function stopConversation() {
    const shouldAskShortlisting =
      statusRef.current !== "initializing" &&
      statusRef.current !== "requesting_permission" &&
      sessionRef.current !== null;
    clearInitialAudioTimer();
    sessionConfigurationResolveRef.current = null;
    connectionRequestRef.current?.abort();
    connectionRequestRef.current = null;
    if (backendEventSessionRef.current) {
      logBackendEvent(
        "session.disconnected",
        undefined,
        performance.now() - backendEventSessionRef.current.startedAt,
      );
      logBackendEvent("microphone.disconnected");
      getAudioController().stopAll();
      logDiagnostic("initialization.music.stopped");
      backendEventSessionRef.current = null;
    } else {
      getAudioController().stopAll();
      logDiagnostic("initialization.music.stopped");
    }
    sessionListenersCleanupRef.current?.();
    sessionListenersCleanupRef.current = null;
    peerConnectionListenersCleanupRef.current?.();
    peerConnectionListenersCleanupRef.current = null;
    sessionRef.current?.close();
    sessionRef.current = null;
    clearRemoteAudio();
    stopMicrophone(microphoneStreamRef.current);
    microphoneStreamRef.current = null;
    diagnostics.endConversation();
    if (!shouldAskShortlisting) {
      updateStatus("idle");
      return;
    }
    updateStatus("ending");
    updateStatus("ending");
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
    realtimeEvents.reset();
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
    initialGreetingTriggeredRef.current = false;
    firstAssistantAudioRef.current = false;
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

      {status === "initializing" && (
        <InitializationMeme
          audioError={audioPlaybackError || memeAudioError}
          canRetryAudio={audioPlaybackError !== ""}
          onRetryAudio={() => void playRemoteAudio()}
        />
      )}

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
