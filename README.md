# Rohit.exe

Rohit.exe is a Next.js portfolio with a real-time voice representative and a
contact form. The Next.js API routes handle OpenAI Realtime session creation,
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

- `OPENAI_API_KEY`
- `RESEND_API_KEY`
- `CONTACT_EMAIL`
- `RESEND_FROM_EMAIL` (optional; defaults to `onboarding@resend.dev`)
- `NEXT_PUBLIC_CALENDLY_URL` (optional)
- `LOG_TRANSCRIPT_TEXT` and `LOG_AI_RESPONSE_TEXT` (optional; default to `false`)

Vercel builds and deploys the Next.js app automatically on pushes to the
connected branch. The `/api/contact`, `/api/realtime/session`, and
`/api/realtime/events` routes are part of that deployment.

The original Python backend under `backend/` is retained for reference and
local testing; it is not used by the Vercel deployment. Contact request
rate-limiting in the Next.js route is in-memory and best-effort on serverless
instances.
