# Architecture

How this application is structured and why. Kept current as each roadmap task
lands; sections describing unbuilt work say so explicitly.

## Application layers

```text
UI (React components)
  -> server action / route handler
  -> service (src/server/services)
  -> database (Supabase) or provider boundary (src/server/integrations)
```

Dependencies only ever point downward. A component never calls Meta's API, and a
provider response shape never reaches a component unchanged.

The number of layers stays proportional to the feature. A trivial read does not
get a repository, a service and a factory just for symmetry.

| Layer                     | Location              | Responsibility                                           |
| ------------------------- | --------------------- | -------------------------------------------------------- |
| Routes                    | `src/app`             | URL structure, layouts, server/client component boundary |
| Shared UI                 | `src/components`      | `ui/` primitives (shadcn), `shared/` app chrome          |
| Feature code              | `src/features`        | Feature-scoped components, schemas, hooks, types         |
| Cross-cutting utilities   | `src/lib`             | Supabase clients, config, errors, logging, validation    |
| Services and integrations | `src/server`          | Business logic; provider-specific code                   |
| Database                  | `supabase/migrations` | Schema, constraints, indexes, RLS policies               |

See [src/features/README.md](../src/features/README.md) and
[src/server/README.md](../src/server/README.md) for the rules each boundary
enforces.

## Route structure

Route groups organize the app without appearing in URLs.

| Route group   | URLs                                                     | Layout                           |
| ------------- | -------------------------------------------------------- | -------------------------------- |
| `(auth)`      | `/sign-in`, `/sign-up`                                   | Centered card, no workspace nav  |
| `(dashboard)` | `/dashboard`, `/conversations`, `/whatsapp`, `/settings` | Sidebar shell                    |
| `admin`       | `/admin`                                                 | Sidebar shell, separate boundary |

`admin` is a plain folder rather than a route group because it is a distinct
authorization boundary, not merely a visual grouping.

`/conversations/[conversationId]` is the only dynamic route so far. Next 16 makes
`params` a Promise, so it is awaited; `next typegen` generates the `PageProps`
and `LayoutProps` helpers that give those params real types, and
`npm run typecheck` runs typegen before `tsc` so they exist on a clean checkout.

## Multi-tenant ownership

**Not implemented yet — Task 2.3.** The intended model:

```text
auth user  ->  profile  ->  membership  ->  workspace
                                              |
                     +------------------------+------------------------+
                     |                        |                        |
             whatsapp_connection        conversation             audit_event
                     |                        |
              (phone number,               message
               WABA identity,
               status)
```

Every tenant-owned row must have an unambiguous path back to a workspace, so an
RLS policy can be written without guesswork. Provider identifiers (phone number
ID, WABA ID, provider message ID) are stored as provider identifiers — never as
the application's own primary keys.

## Authorization and RLS

Authentication ("who is this user?") and authorization ("what workspace may they
touch?") are built separately.

Three independent layers, none of which is trusted alone:

1. **`proxy.ts`** (Next 16's replacement for `middleware.ts`, Node runtime only)
   redirects unauthenticated visitors away from protected routes. This is a
   routing convenience, not a security boundary.
2. **Server-side checks** in services derive the workspace from the session.
   A workspace ID arriving from the browser is never trusted as-is.
3. **Row Level Security** in Postgres independently prevents cross-tenant reads
   and writes. Policies are tested for both the allowed and the denied path.

**Not implemented yet — Tasks 2.2 and 2.3.** Today every route is publicly
reachable, including `/admin`.

## WhatsApp integration boundary

**Not implemented yet — Phase 5 onward.**

All Meta-specific knowledge lives in `src/server/integrations/meta/`: access
tokens, phone number IDs, WABA IDs, webhook payload shapes, provider error
codes, API versioning. The boundary eventually covers official onboarding,
credential exchange and storage, webhook verification and signature validation,
inbound normalization, outbound messaging, provider error normalization, and the
disconnect/reconnect lifecycle.

Two product rules that constrain the design:

- Personal WhatsApp, the WhatsApp Business App, and the WhatsApp Business
  Platform are **different product states**. The onboarding UX must reflect the
  paths Meta actually supports at implementation time, verified against current
  official documentation — not a "merge your personal account" flow that does
  not exist.
- Only official APIs. No WhatsApp Web scraping, browser automation, QR-session
  reuse, or unofficial libraries.

A connection is modeled as an explicit state (`pending`, `connected`,
`disconnected`, `error`), never as a nullable token.

## Webhook lifecycle

**Not implemented yet — Phase 6.** The intended sequence:

```text
1. verify authenticity / signature per Meta's current requirements
2. assign a correlation ID
3. validate the payload shape at runtime
4. extract the provider event / message ID
5. check durable idempotency (a database constraint, never in-memory state)
6. persist the event and the normalized message
7. acknowledge quickly
8. defer expensive work out of the request path where justified
```

Meta retries deliveries, so the provider message ID is the idempotency boundary
and is enforced by a unique constraint rather than by application logic alone.
Unknown event and message types are recorded and safely ignored — one
unrecognized payload must not take down the pipeline.

## Errors and observability

**Not implemented yet — Task 1.2.** The intended shape: a small `AppError` type
carrying a stable code, a safe user-facing message, and internal diagnostic
context; structured logging keyed by request/correlation ID; normalized provider
errors; a consistent API error response format; React error boundaries.

Rules that apply from the start:

- Exceptions are never silently swallowed, and never converted to `null` or an
  empty result.
- Stack traces, SQL errors, access tokens, provider secrets and patient message
  content never reach the client.
- Logs carry `requestId`, `operation`, `providerEventId`, `errorCategory` and —
  only where justified — `workspaceId`. They never carry tokens, secrets,
  webhook signing material, or message bodies.

## Environment and secrets

Two categories, split by prefix:

- **`NEXT_PUBLIC_*`** is inlined into the browser bundle. Non-secret values only.
  The Supabase publishable key belongs here, and is safe there only because RLS
  is enforced.
- **Everything else is server-only.** `SUPABASE_SECRET_KEY` bypasses RLS
  entirely and is used only where genuinely required.

`.env.example` is the authoritative list. `.gitignore` blocks every `.env*` file
except that template. Real credentials are never committed, and production
secrets are never copied into source or local files.

Configuration is validated at runtime (Task 2.1) so a missing variable fails
loudly at startup instead of producing a confusing error later.

## Testing layers

| Layer       | Tool                     | Location            | Covers                                    |
| ----------- | ------------------------ | ------------------- | ----------------------------------------- |
| Unit        | Vitest + Testing Library | `tests/unit`        | Pure logic, component states              |
| Integration | Vitest                   | `tests/integration` | Services, normalization, webhook handling |
| Database    | Supabase CLI             | `supabase/tests`    | RLS allow/deny, constraints, migrations   |
| E2E         | Playwright               | `tests/e2e`         | Real routes and navigation in a built app |

E2E runs against a production build rather than `next dev`, so dev-only
behaviour such as the HMR socket cannot mask a real page error.

Tests protect behavior, not implementation details. The priority order is
authorization, RLS, validation, message normalization, webhook idempotency,
provider error handling, pagination and ordering.

**All development and test data is synthetic.** No real patient name, phone
number, message, image or record belongs in a fixture, seed, log, snapshot or
committed screenshot.
