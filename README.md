# Rohit.exe

Rohit.exe is a Next.js portfolio with a GPT-Live voice representative and a
contact form. The Next.js API routes handle OpenAI GPT-Live session creation,
voice diagnostics, and Resend contact email delivery.

## Local development

1. Install Node.js 22 or later.
2. Copy `.env.example` to `.env.local` and set the required server-side values.
3. Install dependencies with `npm install`.
4. Start the app with `npm run dev`.

The app runs at `http://localhost:3000`. Never commit `.env.local` or real API
keys.

## Deploy to Vercel

Import the GitHub repository into Vercel as a Next.js project, using the
repository root as the project root. Add these environment variables in the
Vercel project settings:

- `OPENAI_API_KEY` (required; server-side only for GPT-Live session creation)
- `RESEND_API_KEY`
- `CONTACT_EMAIL`
- `RESEND_FROM_EMAIL` (optional; defaults to `onboarding@resend.dev`)
- `NEXT_PUBLIC_CALENDLY_URL` (optional)
- `NEXT_PUBLIC_BACKEND_URL` (optional; Python backend origin when using its
  `/api/live/session` and `/api/live/events` endpoints instead of the Next.js
  routes)
- `LOG_TRANSCRIPT_TEXT` and `LOG_AI_RESPONSE_TEXT` (optional; default to `false`)

Vercel builds and deploys the Next.js app automatically on pushes to the
connected branch. The `/api/contact`, `/api/live/session`, and
`/api/live/events` routes are part of that deployment.

The original Python backend under `backend/` serves Live sessions and event
logging when `NEXT_PUBLIC_BACKEND_URL` is set; otherwise the Next.js API routes
are used. Contact-request rate limiting in the Next.js route is in-memory and
best-effort on serverless instances.
