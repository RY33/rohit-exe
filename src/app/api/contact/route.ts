import { NextResponse } from "next/server";

const RATE_LIMIT_REQUESTS = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const MAX_TRACKED_ADDRESSES = 2048;
const contactRequests = new Map<string, number[]>();

interface ContactRequest {
  name: string;
  email: string;
  company?: string;
  message: string;
  website?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkRateLimit(address: string, now: number): boolean {
  for (const [trackedAddress, timestamps] of contactRequests) {
    const activeTimestamps = timestamps.filter(
      (timestamp) => timestamp > now - RATE_LIMIT_WINDOW_MS,
    );
    if (activeTimestamps.length === 0) {
      contactRequests.delete(trackedAddress);
    } else {
      contactRequests.set(trackedAddress, activeTimestamps);
    }
  }

  let timestamps = contactRequests.get(address);
  if (!timestamps) {
    if (contactRequests.size >= MAX_TRACKED_ADDRESSES) {
      return false;
    }
    timestamps = [];
    contactRequests.set(address, timestamps);
  }
  if (timestamps.length >= RATE_LIMIT_REQUESTS) {
    return false;
  }
  timestamps.push(now);
  return true;
}

function isValidEmail(email: string): boolean {
  return (
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

function safeResendError(status: number, sender: string, providerMessage: string): string {
  const isTestingSender = sender.trim().toLowerCase() === "onboarding@resend.dev";
  const testingRecipientRestriction = [
    "testing email",
    "own email address",
    "verify a domain",
    "only send",
  ].some((phrase) => providerMessage.toLowerCase().includes(phrase));

  if (isTestingSender && (testingRecipientRestriction || status === 403)) {
    return (
      "Resend rejected the testing-sender recipient. Confirm CONTACT_EMAIL " +
      "is the verified account email for the same Resend account as RESEND_API_KEY. " +
      "The onboarding sender cannot send to arbitrary recruiter addresses."
    );
  }
  if (status === 401) return "Resend rejected the API key. Check RESEND_API_KEY.";
  if (status === 403) {
    return "Resend denied this request. Check the API key permissions and sender.";
  }
  if (status === 429) return "Resend is rate-limiting email requests. Please wait and try again.";
  if (status >= 500) return "Resend is temporarily unavailable. Please try again later.";
  if (status === 400 || status === 422) {
    return "Resend rejected the sender or recipient settings. Check RESEND_FROM_EMAIL and CONTACT_EMAIL.";
  }
  return "Resend couldn't send this message. Check the email settings and try again.";
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body." }, { status: 400 });
  }
  if (!isRecord(payload)) {
    return NextResponse.json({ detail: "Invalid contact request." }, { status: 422 });
  }

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  const company = typeof payload.company === "string" ? payload.company.trim() : "";
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  const website = typeof payload.website === "string" ? payload.website.trim() : "";
  if (
    (payload.company !== undefined &&
      payload.company !== null &&
      typeof payload.company !== "string") ||
    (payload.website !== undefined &&
      payload.website !== null &&
      typeof payload.website !== "string") ||
    name.length < 1 ||
    name.length > 100 ||
    !isValidEmail(email) ||
    (company && company.length > 120) ||
    message.length < 1 ||
    message.length > 3000 ||
    (website && website.length > 200)
  ) {
    return NextResponse.json({ detail: "Please check the contact form fields." }, { status: 422 });
  }

  const now = Date.now();
  const forwardedFor = request.headers.get("x-forwarded-for");
  const address = forwardedFor?.split(",").at(-1)?.trim() || "unknown";
  if (!checkRateLimit(address, now)) {
    return NextResponse.json(
      { detail: "Too many contact requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "600" } },
    );
  }

  if (website) {
    return NextResponse.json({ success: true });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const destination = process.env.CONTACT_EMAIL?.trim();
  const sender = process.env.RESEND_FROM_EMAIL?.trim() || "onboarding@resend.dev";
  if (!apiKey || !destination || !isValidEmail(destination)) {
    return NextResponse.json(
      { detail: "Contact messaging is not configured. Set RESEND_API_KEY and CONTACT_EMAIL." },
      { status: 503 },
    );
  }

  const messageLines = [`Name: ${name}`, `Email: ${email}`];
  if (company) messageLines.push(`Company: ${company}`);
  messageLines.push("", "Message:", message);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: sender,
        to: [destination],
        reply_to: email,
        subject: "New recruiter message via Rohit.exe",
        text: messageLines.join("\n"),
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!response.ok) {
      let providerMessage = "";
      try {
        const errorBody: unknown = await response.json();
        if (isRecord(errorBody) && typeof errorBody.message === "string") {
          providerMessage = errorBody.message;
        }
      } catch {
        providerMessage = "";
      }
      console.error(`[contact] Resend rejected a notification (HTTP ${response.status}).`);
      return NextResponse.json(
        { detail: safeResendError(response.status, sender, providerMessage) },
        { status: 502 },
      );
    }
  } catch (error) {
    console.error(
      `[contact] Resend request failed (${error instanceof Error ? error.name : "unknown error"}).`,
    );
    return NextResponse.json(
      { detail: "Resend could not be reached." },
      { status: 502 },
    );
  }

  return NextResponse.json({ success: true });
}
