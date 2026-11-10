"use client";

import { motion } from "framer-motion";

interface FinalScreenProps {
  onReplay: () => void;
  onBack: () => void;
}

export default function FinalScreen({ onReplay, onBack }: FinalScreenProps) {
  return (
    <motion.div
      className="final-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="final-screen-title"
    >
      <section className="final-modal">
        <h2 id="final-screen-title" className="final-title">
          THANKS FOR GIVING ROHIT.EXE A CHANCE!
        </h2>
        <div className="final-actions">
          <button type="button" onClick={onReplay} className="final-button">
            Replay conversation
          </button>
          <button
            type="button"
            onClick={onBack}
            className="final-button final-button-secondary"
          >
            Back to portfolio
          </button>
        </div>
      </section>
    </motion.div>
  );
}
