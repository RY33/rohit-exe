"use client";

import Script from "next/script";
import { useState } from "react";
import { CalendarDays, ExternalLink } from "lucide-react";

declare global {
  interface Window {
    Calendly?: {
      initPopupWidget: (options: {
        url: string;
        prefill?: { name?: string; email?: string };
      }) => void;
    };
  }
}

interface CalendlyBookingProps {
  recruiter: { name: string; email: string };
}

const CALENDLY_URL = process.env.NEXT_PUBLIC_CALENDLY_URL?.trim();
const VALIDATED_CALENDLY_URL = (() => {
  if (!CALENDLY_URL) {
    return null;
  }
  try {
    const url = new URL(CALENDLY_URL);
    if (
      url.protocol !== "https:" ||
      !(
        url.hostname.toLowerCase() === "calendly.com" ||
        url.hostname.toLowerCase().endsWith(".calendly.com")
      )
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
})();
const CALENDLY_SCRIPT_URL =
  "https://assets.calendly.com/assets/external/widget.js";
const CALENDLY_STYLESHEET_URL =
  "https://assets.calendly.com/assets/external/widget.css";

export default function CalendlyBooking({
  recruiter,
}: CalendlyBookingProps) {
  const [scriptReady, setScriptReady] = useState(false);
  const [scriptFailed, setScriptFailed] = useState(false);
  const [widgetUnavailable, setWidgetUnavailable] = useState(false);

  function openBooking() {
    if (!VALIDATED_CALENDLY_URL) {
      return;
    }
    if (!window.Calendly) {
      setWidgetUnavailable(true);
      return;
    }

    try {
      window.Calendly.initPopupWidget({
        url: VALIDATED_CALENDLY_URL,
        prefill: {
          ...(recruiter.name.trim() ? { name: recruiter.name.trim() } : {}),
          ...(recruiter.email.trim() ? { email: recruiter.email.trim() } : {}),
        },
      });
    } catch {
      setWidgetUnavailable(true);
    }
  }

  return (
    <div className="calendly-booking">
      {VALIDATED_CALENDLY_URL ? (
        <link rel="stylesheet" href={CALENDLY_STYLESHEET_URL} />
      ) : null}
      {VALIDATED_CALENDLY_URL ? (
        <Script
          src={CALENDLY_SCRIPT_URL}
          strategy="lazyOnload"
          onReady={() => {
            setScriptReady(true);
            setScriptFailed(false);
          }}
          onError={() => setScriptFailed(true)}
        />
      ) : null}

      <button
        className="calendly-button"
        type="button"
        onClick={openBooking}
        disabled={!VALIDATED_CALENDLY_URL}
      >
        <CalendarDays size={20} aria-hidden="true" />
        Book a 15-min chat 📅
      </button>

      {!CALENDLY_URL ? (
        <p className="calendly-message" role="status">
          Add NEXT_PUBLIC_CALENDLY_URL to the frontend environment to enable
          bookings.
        </p>
      ) : null}
      {CALENDLY_URL && !VALIDATED_CALENDLY_URL ? (
        <p className="calendly-message" role="alert">
          NEXT_PUBLIC_CALENDLY_URL must be a valid HTTPS calendly.com event URL.
        </p>
      ) : null}
      {VALIDATED_CALENDLY_URL && (scriptFailed || widgetUnavailable) ? (
        <p className="calendly-message" role="alert">
          The scheduling popup couldn&apos;t load. You can still open the
          booking page directly.
        </p>
      ) : null}
      {VALIDATED_CALENDLY_URL && (scriptFailed || widgetUnavailable) ? (
        <a
          className="calendly-fallback"
          href={VALIDATED_CALENDLY_URL}
          target="_blank"
          rel="noreferrer"
        >
          Open Calendly in a new tab
          <ExternalLink size={15} aria-hidden="true" />
        </a>
      ) : null}
      {VALIDATED_CALENDLY_URL && !scriptReady && !scriptFailed ? (
        <span className="calendly-loading" aria-live="polite">
          Loading secure scheduling...
        </span>
      ) : null}
    </div>
  );
}
