"use client";

import { motion } from "framer-motion";

interface ShortlistingScreenProps {
  onAnswer: (shortlisted: boolean) => void;
}

export default function ShortlistingScreen({
  onAnswer,
}: ShortlistingScreenProps) {
  return (
    <motion.div
      className="shortlisting-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortlisting-title"
    >
      <motion.section
        className="closing-modal"
        initial={{ opacity: 0, y: 20, scale: 0.96, rotate: -0.5 }}
        animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
      >
        <span className="closing-kicker">Final question</span>
        <h2 id="shortlisting-title" className="closing-title">
          ARE YOU INTERESTED IN MY PROFILE?
        </h2>
        <p className="closing-note">
          Choose your answer. The reactions are already queued.
        </p>
        <div className="closing-actions">
          <button
            type="button"
            onClick={() => onAnswer(true)}
            className="closing-button closing-button-yes"
          >
            YES
          </button>
          <button
            type="button"
            onClick={() => onAnswer(false)}
            className="closing-button closing-button-no"
          >
            NO
          </button>
        </div>
      </motion.section>
    </motion.div>
  );
}
