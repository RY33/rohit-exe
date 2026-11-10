"use client";

import { motion } from "framer-motion";

import MemeVisual from "@/components/memes/MemeVisual";

interface ReactionMemeProps {
  shortlisted: boolean;
  audioError: string;
}

export default function ReactionMeme({
  shortlisted,
  audioError,
}: ReactionMemeProps) {
  return (
    <motion.div
      className="reaction-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      role="status"
      aria-live="polite"
    >
      <div className="reaction-modal">
        <MemeVisual
          assetPath={
            shortlisted
              ? "/assets/memes/happy-cat.gif"
              : "/assets/memes/cooked-dog.jpg"
          }
          label={shortlisted ? "Happy cat" : "Cooked dog"}
        />
        <h2 className="reaction-title">
          {shortlisted
            ? "I KNEW I HAD MAIN CHARACTER ENERGY!"
            : "IT'S OKAY... I'LL DEBUG MY PERSONALITY."}
        </h2>
        {audioError && (
          <p role="alert" className="reaction-error">
            {audioError}
          </p>
        )}
      </div>
    </motion.div>
  );
}
