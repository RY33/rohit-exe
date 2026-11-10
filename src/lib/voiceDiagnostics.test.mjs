import assert from "node:assert/strict";
import test from "node:test";

import {
  elapsedMilliseconds,
  formatDiagnosticTimestamp,
  formatLatency,
  redactSensitiveText,
} from "./diagnostics.ts";
import {
  appendTranscriptDelta,
  finalizeTranscriptMessage,
  setResponseTranscriptStatus,
} from "./transcript.ts";

test("partial user transcript updates finalize in the same message", () => {
  const partial = appendTranscriptDelta([], {
    id: "user:item-1",
    speaker: "user",
    source: "user",
    text: "Good morn",
  });
  const updated = appendTranscriptDelta(partial, {
    id: "user:item-1",
    speaker: "user",
    source: "user",
    text: "ing",
  });
  const complete = finalizeTranscriptMessage(updated, {
    id: "user:item-1",
    speaker: "user",
    source: "user",
    text: "Good morning",
  });

  assert.equal(complete.length, 1);
  assert.equal(complete[0].text, "Good morning");
  assert.equal(complete[0].status, "complete");
});

test("assistant transcript deltas remain unique and can be marked interrupted", () => {
  const partial = appendTranscriptDelta([], {
    id: "assistant:item-2",
    responseId: "response-2",
    speaker: "assistant",
    source: "audio",
    text: "I can help",
  });
  const duplicateSource = appendTranscriptDelta(partial, {
    id: "assistant:item-2",
    responseId: "response-2",
    speaker: "assistant",
    source: "text",
    text: "I can help",
  });
  const interrupted = setResponseTranscriptStatus(
    duplicateSource,
    "response-2",
    "interrupted",
  );
  const finalized = finalizeTranscriptMessage(
    interrupted,
    {
      id: "assistant:item-2",
      responseId: "response-2",
      speaker: "assistant",
      source: "audio",
      text: "I can help with that.",
    },
    "interrupted",
  );

  assert.equal(finalized.length, 1);
  assert.equal(finalized[0].text, "I can help with that.");
  assert.equal(finalized[0].status, "interrupted");
});

test("latency measurements use a monotonic duration and report missing values", () => {
  assert.equal(elapsedMilliseconds(10.5, 24.75), 14.25);
  assert.equal(elapsedMilliseconds(null, 24.75), null);
  assert.equal(elapsedMilliseconds(24.75, 10.5), null);
  assert.equal(formatLatency(null), "N/A");
  assert.equal(formatLatency(14.25), "14 ms");
  assert.match(formatDiagnosticTimestamp(Date.now()), /^\d{2}:\d{2}:\d{2}\.\d{3}$/);
  assert.equal(
    redactSensitiveText("Bearer sk-proj-secret ek_secret"),
    "Bearer [REDACTED] [REDACTED]",
  );
});
