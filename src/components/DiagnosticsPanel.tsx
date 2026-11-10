"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Clipboard,
  Pause,
  Play,
  Trash2,
} from "lucide-react";

import {
  formatDiagnosticTimestamp,
  formatLatency,
} from "@/lib/diagnostics";
import type {
  DiagnosticLogEntry,
  VoiceLatencyMetrics,
} from "@/lib/types";

interface DiagnosticsPanelProps {
  entries: DiagnosticLogEntry[];
  metrics: VoiceLatencyMetrics;
  paused: boolean;
  onClear: () => void;
  onTogglePaused: () => void;
}

const latencyRows: Array<{
  key: keyof VoiceLatencyMetrics;
  label: string;
}> = [
  { key: "credentialCreationMs", label: "Backend credentials" },
  { key: "webRtcConnectionMs", label: "WebRTC connection" },
  { key: "speechEndToResponseStartMs", label: "Speech end → response" },
  { key: "speechEndToFirstTextDeltaMs", label: "Speech end → first text" },
  { key: "speechEndToFirstAudioMs", label: "Speech end → first audio" },
  { key: "interruptionToAudioStopMs", label: "Interruption → audio stop" },
  { key: "totalResponseMs", label: "Total AI response" },
];

export default function DiagnosticsPanel({
  entries,
  metrics,
  paused,
  onClear,
  onTogglePaused,
}: DiagnosticsPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copyMessage, setCopyMessage] = useState("");
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = logContainerRef.current;
    if (expanded && autoScroll && container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [autoScroll, entries, expanded]);

  async function copyLogs() {
    const text = entries
      .map((entry) => {
        const detail = entry.detail ? ` — ${entry.detail}` : "";
        return `[${formatDiagnosticTimestamp(entry.timestamp)}] ${entry.event}${detail}`;
      })
      .join("\n");

    try {
      await navigator.clipboard.writeText(text || "No diagnostic events yet.");
      setCopyMessage("Logs copied.");
    } catch {
      setCopyMessage("Clipboard access is unavailable in this browser.");
    }
  }

  return (
    <section className="w-full rounded-2xl border-2 border-[#111111] bg-white">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="voice-diagnostics-content"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[#111111]"
      >
        <span className="flex items-center gap-2 font-bold text-[#111111]">
          {expanded ? (
            <ChevronDown size={18} aria-hidden="true" />
          ) : (
            <ChevronRight size={18} aria-hidden="true" />
          )}
          Voice diagnostics
        </span>
        <span className="text-xs text-[#666666]">{entries.length} events</span>
      </button>

      {expanded && (
        <div id="voice-diagnostics-content" className="space-y-4 border-t-2 border-[#111111] p-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {latencyRows.map(({ key, label }) => (
              <div
                key={key}
                className="flex items-center justify-between gap-2 rounded-lg bg-[#E5E5E5] px-3 py-2 text-xs"
              >
                <span className="text-[#444444]">{label}</span>
                <span className="font-mono text-[#111111]">
                  {formatLatency(metrics[key])}
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClear}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#111111] px-3 py-2 text-xs text-[#111111] hover:bg-[#E5E5E5]"
            >
              <Trash2 size={14} aria-hidden="true" />
              Clear logs
            </button>
            <button
              type="button"
              onClick={onTogglePaused}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#111111] px-3 py-2 text-xs text-[#111111] hover:bg-[#E5E5E5]"
            >
              {paused ? (
                <Play size={14} aria-hidden="true" />
              ) : (
                <Pause size={14} aria-hidden="true" />
              )}
              {paused ? "Resume display" : "Pause display"}
            </button>
            <button
              type="button"
              onClick={copyLogs}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#111111] px-3 py-2 text-xs text-[#111111] hover:bg-[#E5E5E5]"
            >
              <Clipboard size={14} aria-hidden="true" />
              Copy logs
            </button>
            <label className="ml-auto inline-flex items-center gap-2 text-xs text-[#444444]">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(event) => setAutoScroll(event.target.checked)}
                className="accent-[#111111]"
              />
              Auto-scroll
            </label>
          </div>

          {copyMessage && (
            <p role="status" className="text-xs text-[#666666]">
              {copyMessage}
            </p>
          )}

          <div
            ref={logContainerRef}
            aria-live="off"
            className="max-h-64 space-y-1 overflow-y-auto rounded-lg bg-[#E5E5E5] p-3 font-mono text-[11px] leading-5"
          >
            {entries.length === 0 ? (
              <p className="text-[#666666]">No diagnostic events yet.</p>
            ) : (
              entries.map((entry) => (
                <p key={entry.id} className="break-words text-[#111111]">
                  <span className="font-bold">
                    [{formatDiagnosticTimestamp(entry.timestamp)}]
                  </span>{" "}
                  <span className="font-bold">{entry.event}</span>
                  {entry.detail && (
                    <span className="text-[#555555]"> — {entry.detail}</span>
                  )}
                </p>
              ))
            )}
          </div>
          {paused && (
            <p className="text-xs text-[#444444]">
              Display paused. Events are still being collected.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
