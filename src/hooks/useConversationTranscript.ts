"use client";

import { useCallback, useState } from "react";

import type {
  TranscriptMessage,
  TranscriptSource,
  TranscriptSpeaker,
  TranscriptStatus,
} from "@/lib/types";
import {
  appendTranscriptDelta,
  finalizeTranscriptMessage,
  setResponseTranscriptStatus,
} from "@/lib/transcript";

export function useConversationTranscript() {
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);

  const clearTranscript = useCallback(() => {
    setMessages([]);
  }, []);

  const appendDelta = useCallback(
    (
      itemId: string,
      speaker: TranscriptSpeaker,
      source: TranscriptSource,
      delta: string,
      responseId?: string,
    ) => {
      setMessages((currentMessages) =>
        appendTranscriptDelta(currentMessages, {
          id: `${speaker}:${itemId}`,
          speaker,
          source,
          text: delta,
          responseId,
        }),
      );
    },
    [],
  );

  const finalizeMessage = useCallback(
    (
      itemId: string,
      speaker: TranscriptSpeaker,
      source: TranscriptSource,
      text: string,
      responseId?: string,
      status: TranscriptStatus = "complete",
    ) => {
      setMessages((currentMessages) =>
        finalizeTranscriptMessage(
          currentMessages,
          {
            id: `${speaker}:${itemId}`,
            speaker,
            source,
            text,
            responseId,
          },
          status,
        ),
      );
    },
    [],
  );

  const setResponseStatus = useCallback(
    (responseId: string, status: TranscriptStatus) => {
      setMessages((currentMessages) =>
        setResponseTranscriptStatus(currentMessages, responseId, status),
      );
    },
    [],
  );

  return {
    messages,
    clearTranscript,
    appendDelta,
    finalizeMessage,
    setResponseStatus,
  };
}
