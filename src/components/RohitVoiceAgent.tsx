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
