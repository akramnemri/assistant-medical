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

Implemented in Task 2.3 (`supabase/migrations/…_workspace_tenant_model.sql`).
The model:

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

Tables today: `profiles` (1:1 with `auth.users`), `workspaces` (the tenant
boundary), `workspace_members` (membership plus role, keyed on
`(workspace_id, user_id)` so duplicate membership is unrepresentable),
`whatsapp_connections` + `whatsapp_connection_secrets`, and the conversation
tables `contacts`, `conversations` and `messages`.

`workspace_id` is denormalised onto conversations and messages so RLS can
filter without a join. **Composite foreign keys make that copy unforgeable**: a
message references `(conversation_id, workspace_id)` against a matching unique
key on conversations, so a row claiming a workspace that does not own its parent
is rejected with a foreign-key violation rather than quietly stored.

**Provisioning is a database trigger, not application code.** `handle_new_user`
creates the profile, a workspace and the owner membership inside the same
transaction as the `auth.users` insert. A user with no workspace cannot use the
product and a workspace with no owner is unreachable; doing this in a route
handler would leave both states reachable whenever a request failed midway. The
trade-off is that a bug in that function breaks all registration.

**Workspaces are created through `public.create_workspace()`, not a bare
insert.** There is deliberately no INSERT policy on `workspaces`: a workspace
inserted directly would have no owner and be immediately invisible to everyone.
The function creates both rows together and always makes the caller the owner,
so it cannot be used to join an existing workspace.

**Membership lookups go through `is_workspace_member()` / `has_workspace_role()`,
which are `SECURITY DEFINER`.** This is load-bearing: a policy on
`workspace_members` that queried `workspace_members` would recurse infinitely.
Running the lookup as the function owner bypasses RLS for that one read and
breaks the cycle. Each such function sets `search_path = ''` and fully qualifies
every identifier, closing the classic `SECURITY DEFINER` escalation route, and
`EXECUTE` is revoked from `public`/`anon` and granted only to `authenticated`.

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

Authentication is implemented (Task 2.2): email/password via Supabase Auth,
with `src/proxy.ts` redirecting signed-out visitors away from `/dashboard`,
`/conversations`, `/whatsapp`, `/settings` and `/admin`, and signed-in visitors
away from the auth pages.

The proxy does two things: it refreshes the session (access tokens expire
hourly, and a Server Component cannot write the rotated cookie, so without this
users would be silently signed out), and it gates routing. When it redirects it
copies the refreshed cookies onto the redirect response — a bare
`NextResponse.redirect` would discard them.

Tenant authorization is implemented at the database level (Task 2.3). RLS is
enabled on all three tables, and the policies are verified by 29 pgTAP
assertions in `supabase/tests/` covering the denied paths as well as the allowed
ones — a policy that grants correctly but fails to deny looks identical from the
application until one doctor sees another's patients.

Two testing details worth preserving when adding tables:

- Cross-tenant writes must be attempted with a **literal** id captured before
  the role switch. Deriving the target from a sub-select makes the test pass for
  the wrong reason: RLS filters the sub-select to zero rows, the write becomes a
  no-op, and the policy is never exercised.
- A blocked UPDATE or DELETE does not raise — it matches no row — so absence of
  effect is verified afterwards from a privileged connection.

**Role-based authorization within the product is still open.** `/admin` is
reachable by any signed-in user; the `owner`/`admin`/`member` roles exist and
gate workspace updates and deletes, but no route checks them yet.

Sign-in deliberately returns the same message for an unknown email and a wrong
password. Distinguishing them would let anyone test whether a given doctor has
an account here, which on a medical platform is itself sensitive. The `?next=`
return path is validated against absolute, scheme-relative and control-character
URLs, so the sign-in page cannot be turned into an open redirect.

## WhatsApp connection model

Implemented in Task 3.1. A connection is a **lifecycle**, not "a phone number
plus a token": onboarding can be half-finished, Meta can revoke access without
telling us, and a disconnected number can be reconnected later. A nullable token
cannot distinguish "never started" from "in progress" from "deliberately
disconnected" from "broken" — which is exactly the distinction support needs.

Status is an enum (`pending`, `connected`, `disconnected`, `error`) and
transitions are enforced by a trigger, because the onboarding callback, the
webhook and future admin tooling all write that column. A rule enforced in one
of three writers holds two thirds of the time.

Two check constraints stop an unusable row being marked usable: `connected`
requires both provider identifiers, and `error` requires a reason.

**Credentials are in a separate table**, `whatsapp_connection_secrets`, with RLS
enabled and **no policies at all** — plus privileges revoked from `anon` and
`authenticated`. That combination leaves it reachable only by `service_role`
from trusted server code. Keeping the token on the connection row would mean one
careless `select *` in a server component ships a Meta access token to the
browser. A pgTAP test asserts the policy count is zero, so adding one later has
to be a deliberate act.

**A live number belongs to exactly one workspace**, enforced by a partial unique
index on `phone_number_id` scoped to active statuses. Without it two workspaces
could both claim a number and inbound messages would route to whichever row was
found first — a cross-tenant leak no RLS policy would catch, because both rows
are legitimately owned. Scoping to active statuses means a released number can
still be connected elsewhere later.

There is no RLS write policy: connections are created and transitioned by
server-side code holding the secret key, never by the browser.

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

## Conversations and messages

Implemented in Task 3.2.

**Idempotency** is a partial unique index on `messages.provider_message_id`. A
duplicate delivery raises `23505`, which the webhook will treat as "already
processed". A handler that checked for existence first and then inserted would
race against its own retry; a constraint cannot be raced. The index is partial
because an outbound message has no provider id until the provider accepts it.

**Ordering uses `(sent_at, id)`, never `sent_at` alone.** Meta's timestamps have
one-second resolution, so several messages routinely share one — a cursor on the
timestamp alone would skip or repeat rows at a page boundary. The seed
deliberately contains three messages sharing a timestamp so that bug is
reproducible rather than intermittent, and a test asserts two keyset pages do
not overlap.

`sent_at` (what the provider reports) is kept distinct from `created_at` (when we
stored it). They differ by however long delivery and retries took, and only the
provider's timestamp orders a thread correctly.

**Conversation summaries are maintained by trigger**, not by the webhook
handler, so `last_message_at` and `unread_count` cannot drift when a message is
inserted by a backfill or a test. `last_message_at` uses `greatest()`, so a
late-arriving older delivery cannot drag a thread backwards in the list.

A contact is scoped to a workspace: the same person messaging two doctors is two
contacts, so one tenant's patient list can never be inferred from another's.
`unread_count` is workspace-level, which is correct while a workspace has one
doctor and becomes wrong — not merely incomplete — once team members exist.

Messages store normalised fields only. The raw provider payload belongs with the
webhook event record, which has its own retention story, rather than duplicating
patient content on every message row.

## Errors and observability

Implemented in Task 1.2.

**`AppError`** (`src/lib/errors/app-error.ts`) carries a stable code, a
user-facing message and internal `context`. The rule everything else relies on:
**`AppError.message` is always safe to show a user.** Internal detail lives in
`context` or `cause`, which are logged and never serialized into a response.
That makes leaking internals something you have to do deliberately.

**Error codes** are a public contract. Add freely; never rename or repurpose.

**`normalizeError`** (`src/lib/errors/normalize.ts`) reduces any thrown value to
a loggable shape. JavaScript lets you throw a string, `undefined` or a plain
object, and all of those reach a catch block eventually.

**`toErrorResponse`** (`src/lib/errors/response.ts`) is the single place a failed
request is turned into a response. It returns only `{ code, message, requestId }`
— never a stack, cause, context or provider payload. An unexpected throw becomes
a generic `UNKNOWN`, because nothing has vetted what its message contains. 4xx
logs at `warn` (keeping the AppError's context, since "which field failed" is
the diagnostic value); 5xx logs at `error` with the stack.

**The logger** (`src/lib/logger/logger.ts`) emits one JSON object per line, with
no logging dependency. `buildLogEntry` is exported separately so tests can assert
on the exact structure, including what redaction removed.

**Redaction** (`src/lib/logger/redact.ts`) is the control that matters, and it
runs over the caller's context _and_ the normalized error — an `AppError`'s own
context is easy to populate with a raw provider payload. Two mechanisms:

- _Key-based_, the primary control. Keys are normalized (`wa_id`, `WA-ID` and
  `waId` collapse to the same form) so a new casing convention cannot bypass it.
  Most patterns match as substrings; `body`, `text` and `caption` match
  **exactly**, because matching "text" as a substring also redacts `context` and
  silently guts every error log.
- _Inline scrubbing_, best-effort defence in depth for secrets embedded in free
  text — typically a database driver putting a connection string into an error
  message. This is not a guarantee, which is why error messages remain
  internal-only.

**Correlation IDs** (`src/lib/request-id.ts`) are generated per request, returned
in the `x-request-id` header and the response body, and attached to every log
line. An inbound ID is reused only if it matches `[A-Za-z0-9_-]{1,128}` — an
attacker-supplied newline would otherwise let a caller forge log entries.

**Error boundaries**: `src/app/error.tsx` for route segments and
`src/app/global-error.tsx` for failures in the root layout itself. The latter
renders its own `<html>`/`<body>` with inline styles, since a broken root layout
may be exactly what failed. Both surface Next's `digest`, which matches the
server log, so a user has something to quote.

**Development-only routes**: `/api/dev/error` and `/dev/throw` exercise these
paths by hand. Both return 404 outside development, and an E2E test asserts that
against a real production build.

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

Configuration is validated with zod and split across two modules:

- `src/lib/config/client-env.ts` — public values, safe anywhere. The
  `process.env.NEXT_PUBLIC_*` reads are written out literally, because Next only
  inlines them into the browser bundle in that form.
- `src/lib/config/server-env.ts` — starts with `import "server-only"`, so
  importing it from a client component **fails the build**. That is a build-time
  guarantee rather than a review convention.

Validation reports every invalid variable at once and points at `.env.example`.
An optional variable set to `""` — which is how the template ships — is treated
as unset.

## Supabase clients

Three clients, with deliberately different privileges. Choosing the wrong one is
the easiest way to break tenant isolation, so the distinction is explicit.

| Client  | Module               | Key         | RLS          |
| ------- | -------------------- | ----------- | ------------ |
| Browser | `supabase/client.ts` | publishable | **enforced** |
| Server  | `supabase/server.ts` | publishable | **enforced** |
| Admin   | `supabase/admin.ts`  | secret      | **bypassed** |

The server client uses the _publishable_ key on purpose: it acts as the
signed-in user, so server-side code is not automatically privileged and a wrong
query still cannot read another workspace's rows.

The admin client exists for operations with no user session to act on behalf
of — chiefly the Meta webhook, which is authenticated by signature and must
write a message for a workspace nobody is signed in to. Every call site needs a
comment justifying why the RLS-bound client is insufficient. It throws
`CONFIGURATION_ERROR` when the secret key is absent rather than silently falling
back, which would look like it worked while quietly being subject to policies.

Clients are created per request, never held as module-level singletons: a shared
instance would leak one user's auth state into another request during
server-side rendering.

**Session helpers** (`supabase/session.ts`) always use `auth.getUser()`, never
`auth.getSession()`. `getSession()` returns whatever is in the cookie without
verifying it against the auth server, so a forged or stale cookie would be
trusted. On the server, where the answer decides what data a request may read,
only the revalidated result is safe to act on.

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
