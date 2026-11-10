import type {
  TranscriptMessage,
  TranscriptSource,
  TranscriptSpeaker,
  TranscriptStatus,
} from "@/lib/types";

interface TranscriptUpdate {
  id: string;
  speaker: TranscriptSpeaker;
  source: TranscriptSource;
  responseId?: string;
  text: string;
}

export function appendTranscriptDelta(
  messages: TranscriptMessage[],
  update: TranscriptUpdate,
): TranscriptMessage[] {
  if (!update.text) {
    return messages;
  }

  const messageIndex = messages.findIndex((message) => message.id === update.id);
  if (messageIndex === -1) {
    return [
      ...messages,
      {
        ...update,
        status: "generating",
      },
    ];
  }

  const existing = messages[messageIndex];
  if (existing.source !== update.source) {
    return messages;
  }

  const next = [...messages];
  next[messageIndex] = {
    ...existing,
    text: existing.text + update.text,
    responseId: update.responseId ?? existing.responseId,
    status: "generating",
  };
  return next;
}

export function finalizeTranscriptMessage(
  messages: TranscriptMessage[],
  update: TranscriptUpdate,
  status: TranscriptStatus = "complete",
): TranscriptMessage[] {
  const messageIndex = messages.findIndex((message) => message.id === update.id);
  if (messageIndex === -1) {
    return [
      ...messages,
      {
        ...update,
        status,
      },
    ];
  }

  const next = [...messages];
  next[messageIndex] = {
    ...next[messageIndex],
    text: update.text,
    responseId: update.responseId ?? next[messageIndex].responseId,
    status,
  };
  return next;
}

export function setResponseTranscriptStatus(
  messages: TranscriptMessage[],
  responseId: string,
  status: TranscriptStatus,
): TranscriptMessage[] {
  return messages.map((message) =>
    message.speaker === "assistant" && message.responseId === responseId
      ? { ...message, status }
      : message,
  );
}
