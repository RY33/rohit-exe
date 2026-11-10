"use client";

import { useState, type FormEvent } from "react";
import { ArrowUpRight, LoaderCircle } from "lucide-react";

interface RecruiterDetails {
  name: string;
  email: string;
}

interface ContactFormProps {
  onRecruiterChange: (recruiter: RecruiterDetails) => void;
}

interface ContactFields extends RecruiterDetails {
  company: string;
  message: string;
  website: string;
}

const INITIAL_FIELDS: ContactFields = {
  name: "",
  email: "",
  company: "",
  message: "",
  website: "",
};

export default function ContactForm({
  onRecruiterChange,
}: ContactFormProps) {
  const [fields, setFields] = useState(INITIAL_FIELDS);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  function updateField<K extends keyof ContactFields>(
    key: K,
    value: ContactFields[K],
  ) {
    setFields((current) => ({ ...current, [key]: value }));
    setFeedback(null);
    if (key === "name" || key === "email") {
      onRecruiterChange({
        name: key === "name" ? value : fields.name,
        email: key === "email" ? value : fields.email,
      });
    }
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!response.ok) {
        let errorMessage =
          "We couldn't send that just now. Please try again in a moment.";
        try {
          const errorBody: unknown = await response.json();
          if (
            typeof errorBody === "object" &&
            errorBody !== null &&
            "detail" in errorBody &&
            typeof errorBody.detail === "string"
          ) {
            errorMessage = errorBody.detail;
          }
        } catch {
          // Keep the generic message when the backend response is not JSON.
        }
        setFeedback({ kind: "error", message: errorMessage });
        return;
      }
      setFeedback({
        kind: "success",
        message: "Message sent. Rohit will be in touch soon!",
      });
    } catch {
      setFeedback({
        kind: "error",
        message:
          "We couldn't send that just now. Please try again in a moment.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="contact-form" onSubmit={submitMessage}>
      <label className="contact-field">
        <span>Name <span aria-hidden="true">*</span></span>
        <input
          autoComplete="name"
          name="name"
          required
          maxLength={100}
          value={fields.name}
          onChange={(event) => updateField("name", event.target.value)}
        />
      </label>

      <label className="contact-field">
        <span>Email <span aria-hidden="true">*</span></span>
        <input
          autoComplete="email"
          name="email"
          type="email"
          required
          maxLength={254}
          value={fields.email}
          onChange={(event) => updateField("email", event.target.value)}
        />
      </label>

      <label className="contact-field">
        <span>Company <span className="contact-optional">(optional)</span></span>
        <input
          autoComplete="organization"
          name="company"
          maxLength={120}
          value={fields.company}
          onChange={(event) => updateField("company", event.target.value)}
        />
      </label>

      <label className="contact-field">
        <span>Message <span aria-hidden="true">*</span></span>
        <textarea
          name="message"
          required
          minLength={1}
          maxLength={3000}
          rows={4}
          value={fields.message}
          onChange={(event) => updateField("message", event.target.value)}
        />
      </label>

      <label className="contact-honeypot" aria-hidden="true">
        Leave this field empty
        <input
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={fields.website}
          onChange={(event) => updateField("website", event.target.value)}
        />
      </label>

      {feedback ? (
        <p
          className={`contact-feedback contact-feedback-${feedback.kind}`}
          role={feedback.kind === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {feedback.message}
        </p>
      ) : null}

      <button
        className="contact-submit"
        type="submit"
        disabled={isSubmitting}
      >
        {isSubmitting ? (
          <>
            <LoaderCircle size={18} className="contact-spinner" aria-hidden="true" />
            Sending...
          </>
        ) : (
          <>
            Send to Rohit 🚀
            <ArrowUpRight size={18} aria-hidden="true" />
          </>
        )}
      </button>
    </form>
  );
}
