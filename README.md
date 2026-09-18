# Doctor WhatsApp Platform

A multi-tenant SaaS application that lets doctors centralize and manage patient
conversations received through WhatsApp.

> **Status: Phase 2 — Supabase foundation.** Tooling, the route structure and
> the Supabase client/config layer exist. Authentication, the database schema
> and the WhatsApp integration are not implemented yet, and no route is
> access-controlled.

## Stack

| Concern         | Choice                                                    |
| --------------- | --------------------------------------------------------- |
| Framework       | Next.js 16 (App Router) + React 19 + TypeScript (strict)  |
| Styling         | Tailwind CSS v4 (shadcn/ui components added when needed)  |
| Backend         | Supabase — Auth, PostgreSQL, Row Level Security, Realtime |
| Messaging       | Meta WhatsApp Business Platform / Cloud API (Phase 5+)    |
| Hosting         | Vercel                                                    |
| Package manager | npm                                                       |

## Requirements

- Node.js 22+
- npm 10+
- Docker (for the local Supabase stack, from Phase 2 onward)

## Setup

```bash
npm install
cp .env.example .env.local
```

### Local Supabase

Development runs against a local Supabase stack in Docker, not a hosted
project. Start Docker Desktop, then:

```bash
npx supabase start
```

The first run downloads several GB of images and takes a while. When it
finishes it prints the local URL and keys. Copy them into `.env.local`:

- `API URL` → `NEXT_PUBLIC_SUPABASE_URL`
- the publishable / `anon` key → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- the secret / `service_role` key → `SUPABASE_SECRET_KEY` (optional; only
  needed for features that must bypass Row Level Security)

Reprint them at any time with `npx supabase status`, and stop the stack with
`npx supabase stop`. Supabase Studio runs at <http://127.0.0.1:54323>.

### Run the app

```bash
npm run dev
```

The app runs at <http://localhost:3000>. In development,
<http://localhost:3000/api/dev/supabase> reports whether configuration parsed
and the local stack is reachable.

## Commands

| Command                | Purpose                                          |
| ---------------------- | ------------------------------------------------ |
| `npm run dev`          | Development server                               |
| `npm run build`        | Production build                                 |
| `npm start`            | Serve the production build                       |
| `npm run typecheck`    | TypeScript, no emit                              |
| `npm run lint`         | ESLint (warnings fail)                           |
| `npm run format`       | Prettier, write                                  |
| `npm run format:check` | Prettier, check only                             |
| `npm test`             | Unit + integration tests (Vitest)                |
| `npm run test:watch`   | Vitest in watch mode                             |
| `npm run test:e2e`     | End-to-end tests (Playwright)                    |
| `npm run verify`       | Full gate: typecheck, lint, format, tests, build |

Run `npm run verify` before opening a pull request. `npm run test:e2e` requires
a one-time `npx playwright install chromium`.

## Environment variables

See `.env.example` for the authoritative list. The split that matters:

- **`NEXT_PUBLIC_*`** is inlined into the browser bundle. Non-secret values only.
  The Supabase publishable key belongs here and is safe there _only_ because RLS
  is enforced.
- **Everything else is server-only.** `SUPABASE_SECRET_KEY` bypasses Row Level
  Security. Modules that read it import `server-only`, so importing one from a
  client component fails the build rather than shipping a secret.

Configuration is validated at startup with zod. A missing or malformed variable
fails with a message naming it, instead of surfacing later as a confusing
runtime error.

Never commit a filled-in `.env.local`. `.gitignore` blocks all `.env*` files
except the template.

## Project structure

```text
src/
├─ app/          Next.js App Router routes
├─ components/   Shared and UI components
├─ features/     Feature-scoped code (auth, conversations, whatsapp, ...)
├─ lib/          Supabase clients, config, errors, logging, validation
├─ server/       Services and external-provider integrations
└─ types/

supabase/        Migrations, database functions, database tests
tests/           unit/ integration/ e2e/
docs/            Architecture and integration notes
```

Folders are created when their responsibility becomes real, not upfront.

Architectural rules of the codebase:

1. Business logic stays out of presentation code.
2. Provider-specific code (Meta, Gemini) stays behind an integration boundary in
   `src/server/integrations/`. UI components never call a provider API directly.
3. Secrets are server-only.
4. Tenant isolation is enforced in the database through RLS, not only in
   application code.
5. Webhook processing is idempotent — Meta retries deliveries.

Detailed notes live in [docs/architecture.md](docs/architecture.md).

## Branching and workflow

```text
main      production-ready
  ^
develop   integration
  ^
feat/*    one bounded task each
```

Every task: implement → automated checks → **stop for manual testing** → merge to
`develop` after the manual result is reported. Never develop directly on `main`.

## Current milestone

The first milestone is a trustworthy inbound message pipeline:

```text
Doctor signs in
  -> connects an eligible WhatsApp Business Platform number via Meta's official flow
  -> Meta sends a real inbound event
  -> webhook is verified and validated
  -> event is processed idempotently
  -> message is stored exactly once, in the correct workspace and conversation
  -> Supabase Realtime updates the browser without a refresh
```

It is **not** complete if the message only appears after a manual refresh, if it
was inserted by a test script rather than a real inbound event, if a duplicate
webhook delivery creates a duplicate message, or if one doctor can reach another
doctor's conversations.

## Security notes

This application processes doctor–patient conversations. Accordingly:

- Use **synthetic data only** in development and testing. No real patient names,
  phone numbers, messages, images, or records in fixtures, seeds, logs, or
  screenshots.
- Keep all provider credentials server-side.
- Enforce tenant isolation with RLS and test both the allowed and denied paths.
- Log correlation IDs and operation names — never tokens, secrets, or message
  content.
- Only official Meta APIs. No WhatsApp Web scraping, browser automation, or
  unofficial libraries.
- Patient content is not sent to any AI provider without an explicit, documented
  data-flow and privacy decision.
- Using Supabase and TLS does not by itself constitute HIPAA/GDPR compliance. No
  compliance claim is made without a real legal and security assessment.

## License

MIT — see [LICENSE](LICENSE). Note that MIT permits unrestricted reuse by anyone;
revisit this if the project is intended to stay proprietary.
