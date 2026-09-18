# Server

Server-only code. Nothing here may be imported from a client component.

```text
src/server/
├─ services/       Application and business logic
└─ integrations/
   ├─ meta/        WhatsApp Business Platform / Cloud API
   └─ gemini/      AI provider (post-MVP)
```

## services/

Application logic that coordinates the database and integrations: fetching a
workspace's conversations, persisting an inbound message, completing an
onboarding callback. Services own authorization checks and transactions.

Created from Task 3.3 onward.

## integrations/

Everything that understands a specific external provider: access tokens, phone
number IDs, WABA IDs, webhook payload shapes, provider error codes, API
versions.

Created from Task 5.3 onward.

## Rules

- **Provider shapes stop at this boundary.** An integration converts a provider
  payload into the internal domain model and returns that. A Meta-specific type
  must never reach a React component or a database row definition unchanged.
- **Credentials are server-only.** No provider secret is ever passed to the
  browser or embedded in a `NEXT_PUBLIC_*` variable.
- **Treat every provider as unreliable.** Each external call considers timeouts,
  provider errors, retries, idempotency, partial failure and rate limits.
- **Never retry a non-idempotent operation blindly.**
- **Only official APIs.** No WhatsApp Web scraping, browser automation or
  unofficial libraries.

Direction of dependencies:

```text
UI  ->  action / route handler  ->  service  ->  database or provider boundary
```

Never the reverse, and never UI straight to a provider.
