import type { VoiceLatencyMetrics } from "@/lib/types";

export const EMPTY_LATENCY_METRICS: VoiceLatencyMetrics = {
  credentialCreationMs: null,
  webRtcConnectionMs: null,
  speechEndToResponseStartMs: null,
  speechEndToFirstTextDeltaMs: null,
  speechEndToFirstAudioMs: null,
  interruptionToAudioStopMs: null,
  totalResponseMs: null,
};

export function elapsedMilliseconds(
  start: number | null,
  end: number,
): number | null {
  if (start === null || !Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }

  const elapsed = end - start;
  return elapsed >= 0 ? elapsed : null;
}

export function formatDiagnosticTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");
  return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}

export function formatLatency(value: number | null): string {
  return value === null ? "N/A" : `${Math.round(value)} ms`;
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/\b(?:sk|ek)[-_][A-Za-z0-9_-]+\b/gi, "[REDACTED]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]");
}
