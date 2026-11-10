"use client";

import type { TranscriptMessage } from "@/lib/types";

interface ConversationTranscriptProps {
  messages: TranscriptMessage[];
}

export default function ConversationTranscript({
  messages,
}: ConversationTranscriptProps) {
  const latestAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.speaker === "assistant");

  return (
    <section
      aria-label="Rohit.exe speech"
      aria-live="polite"
      className="voice-transcript"
    >
      {latestAssistantMessage && (
        <p className="break-words whitespace-pre-wrap">
          {latestAssistantMessage.text}
        </p>
      )}
    </section>
  );
}
