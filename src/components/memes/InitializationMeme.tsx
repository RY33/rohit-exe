"use client";

import { motion } from "framer-motion";

import MemeVisual from "@/components/memes/MemeVisual";

interface InitializationMemeProps {
  audioError: string;
  canRetryAudio: boolean;
  onRetryAudio: () => void;
}

export default function InitializationMeme({
  audioError,
  canRetryAudio,
  onRetryAudio,
}: InitializationMemeProps) {
  return (
    <motion.div
      className="initialization-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      role="status"
      aria-live="polite"
    >
      <div className="initialization-modal">
        <MemeVisual
          assetPath="/assets/memes/spinning-cat.gif"
          label="Spinning cat"
        />
        <h2 className="initialization-title">Rohit.exe is waking up...</h2>
        {audioError && (
          <>
            <p role="alert" className="initialization-error">
              {audioError}
            </p>
            {canRetryAudio && (
              <button
                type="button"
                onClick={onRetryAudio}
                className="retry-button mt-4"
              >
                Retry AI audio
              </button>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}
