# Rohit.exe

Rohit.exe is a Next.js portfolio with a GPT-Live voice representative and a
contact form. The voice client sends session and diagnostic requests to the
separately deployed Python API; the Next.js API routes also include server-side
Live session and contact handlers.

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
- `NEXT_PUBLIC_BACKEND_URL` (required; Python backend origin, for example
  `https://rohit-exe-api.vercel.app`)
- `LOG_TRANSCRIPT_TEXT` and `LOG_AI_RESPONSE_TEXT` (optional; default to `false`)

Vercel builds and deploys the Next.js app automatically on pushes to the
connected branch. The `/api/contact`, `/api/live/session`, and
`/api/live/events` routes are part of that deployment. Deploy the Python API as
a separate Vercel project with `backend` as its root directory, and configure
`NEXT_PUBLIC_BACKEND_URL` in the frontend project's Production environment.
The canonical voice session endpoint is
`POST https://rohit-exe-api.vercel.app/api/live/session`; the backend also
accepts the older `/api/realtime/session` path for compatibility with existing
frontend deployments. `GET /health` reports the service and non-secret
deployment identity.

The Python backend under `backend/` serves Live sessions and event logging.
Contact-request rate limiting in the Next.js route is in-memory and best-effort
on serverless instances.
