"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

import CalendlyBooking from "@/components/CalendlyBooking";
import ContactForm from "@/components/ContactForm";

interface ContactModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ContactModal({
  isOpen,
  onClose,
}: ContactModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [recruiter, setRecruiter] = useState({ name: "", email: "" });

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled])',
      );
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus();
      }
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          className="contact-backdrop"
          key="contact-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              onClose();
            }
          }}
        >
          <motion.div
            ref={dialogRef}
            className="contact-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="contact-title"
            aria-describedby="contact-subtitle"
            tabIndex={-1}
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <button
              type="button"
              className="contact-close"
              onClick={onClose}
              aria-label="Close contact options"
            >
              <X size={20} aria-hidden="true" />
            </button>

            <header className="contact-heading">
              <span className="contact-kicker">Your next chapter</span>
              <h2 id="contact-title">
                You&apos;ve met Rohit.exe. Now meet the human. 👀
              </h2>
              <p id="contact-subtitle">
                Liked the conversation? Let&apos;s make something happen.
              </p>
            </header>

            <div className="contact-options">
              <section className="contact-option contact-message-option">
                <span className="contact-option-number">01 / MESSAGE</span>
                <h3>Send Rohit a message</h3>
                <ContactForm
                  onRecruiterChange={setRecruiter}
                />
              </section>

              <section className="contact-option contact-meeting-option">
                <span className="contact-option-number">02 / MEET</span>
                <h3>Schedule a meeting</h3>
                <p>
                  Pick a time for a quick, 15-minute chat. Calendly handles the
                  details.
                </p>
                <CalendlyBooking recruiter={recruiter} />
              </section>
            </div>
            <p className="contact-modal-footnote">
              No pressure. No auto-sends. You&apos;re always in control.
            </p>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
