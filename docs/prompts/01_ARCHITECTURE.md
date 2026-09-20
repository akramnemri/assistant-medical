# Prompt 01 — Architecture & Project Skeleton

Act as the senior software architect and lead engineer for this project.

Your first job is to establish a professional, maintainable foundation for a SaaS application that helps doctors centralize and manage patient conversations received through WhatsApp.

## Project context

Stack:

- Vercel
- Next.js + TypeScript
- Supabase: Auth, PostgreSQL, Row Level Security, Realtime, Storage where needed
- Meta WhatsApp Business Platform / Cloud API
- Gemini API may be added later through a provider abstraction

Core product direction:

- Doctors authenticate with email + password.
- An authenticated doctor/workspace connects an eligible WhatsApp Business / WhatsApp Business Platform number through Meta's official onboarding flow.
- Inbound WhatsApp events are received by our backend, normalized, persisted in Supabase, and shown in the correct doctor's application.
- Later we will add conversation organization, metrics, labels, automated menus/bots, outbound messaging, admin approval, and AI-assisted functionality.

The first mini-demo is successful only when:

    WhatsApp message
      -> Meta webhook
      -> server-side validation
      -> idempotent persistence
      -> correct workspace/conversation
      -> Supabase Realtime
      -> authenticated browser UI
      -> message visible without manual refresh

Do not implement that flow yet. Build the foundation first.

## 1. Architecture principles

Design around these rules:

1. Human readability beats cleverness.
2. Business logic must be separated from presentation.
3. External provider code must be isolated behind a clear integration boundary.
4. Secrets are server-only.
5. Tenant isolation must be designed into the database, not added later.
6. Supabase RLS is part of the authorization boundary.
7. Webhook processing must be idempotent.
8. Important workflows need explicit error paths.
9. Every feature must be testable independently.
10. Prefer the simplest architecture that can safely support growth.
11. Avoid premature microservices, queues, or abstractions unless the first implementation has a concrete need for them.
12. Keep the codebase easy for a different developer to inspect and debug.

## 2. Project structure

Use one well-organized Next.js application unless the existing repository gives a strong reason not to.

Target structure:

```text
src/
├─ app/
│  ├─ (auth)/
│  ├─ (dashboard)/
│  ├─ admin/
│  ├─ api/
│  ├─ error.tsx
│  ├─ loading.tsx
│  └─ not-found.tsx
│
├─ components/
│  ├─ ui/
│  └─ shared/
│
├─ features/
│  ├─ auth/
│  ├─ conversations/
│  ├─ whatsapp/
│  ├─ admin/
│  └─ settings/
│
├─ lib/
│  ├─ supabase/
│  ├─ config/
│  ├─ errors/
│  ├─ logger/
│  ├─ validation/
│  └─ utils/
│
├─ server/
│  ├─ services/
│  └─ integrations/
│     ├─ meta/
│     └─ gemini/
│
└─ types/

supabase/
├─ migrations/
├─ functions/
├─ tests/
└─ seed.sql

tests/
├─ unit/
├─ integration/
└─ e2e/

scripts/
docs/
public/
.env.example
README.md
```

Do not create empty folders simply to match the diagram. Create a folder when its responsibility becomes real.

## 3. Feature boundaries

Complex features belong inside their own feature folder.

Example:

```text
src/features/conversations/
├─ components/
├─ schemas/
├─ hooks/
├─ types.ts
└─ utils.ts
```

Use `src/server/services/` for application/business services.

Use `src/server/integrations/meta/` for code that understands Meta's API, webhook format, access tokens, phone-number IDs, WABA IDs, provider errors, and similar provider-specific details.

Never let arbitrary UI components directly call Meta's API.

Preferred direction:

```text
UI
 -> application/service layer
 -> provider or database boundary
```

Do not turn this into a huge enterprise architecture with unnecessary layers. Apply boundaries where they make the code easier to understand, test, or replace.

## 4. Multi-tenant data model

The application must be designed as multi-tenant from the beginning.

Model the concepts needed for:

- authenticated users;
- doctor/workspace/business ownership;
- memberships/roles if more than one staff member may use a workspace;
- WhatsApp connections;
- WhatsApp Business Account / provider identity;
- WhatsApp phone-number identity;
- conversations;
- patient/contact identity as the product evolves;
- messages;
- webhook events/idempotency records;
- audit events.

Every tenant-owned row must have an obvious ownership path that makes RLS straightforward.

Use provider IDs as provider identifiers, not as replacements for the application's internal primary keys.

Add constraints and indexes based on actual query patterns, especially around:

- workspace ownership;
- conversation ordering;
- conversation status/unread state;
- message chronology;
- provider message IDs;
- webhook event IDs;
- WhatsApp phone number IDs.

Do not load an entire message history when a paginated query is sufficient.

## 5. Authentication and authorization

Build authentication separately from authorization.

Authentication answers: "Who is this user?"

Authorization answers: "Which workspace/data can this user access?"

Do not trust a client-supplied workspace ID without an authorization check.

The database must independently prevent cross-tenant reads and writes.

Create policies for the relevant CRUD operations and include database tests for allowed and denied access.

Never expose Supabase secret/service-role credentials to browser code. Modern Supabase projects may use publishable/secret API keys; the publishable key belongs in public client code only with proper RLS, while secret/service-role access remains server-only.

## 6. WhatsApp integration boundary

Treat Meta as an unreliable external dependency.

The integration boundary must eventually support:

- official onboarding / Embedded Signup where applicable;
- account and phone-number identification;
- secure server-side credential exchange/storage;
- webhook verification;
- webhook signature/authenticity validation as required by Meta;
- inbound message normalization;
- outbound messaging later;
- provider error normalization;
- disconnect/reconnect lifecycle.

Important product correction:

Do NOT build a fake flow called "merge your personal WhatsApp into a Business account."

A personal WhatsApp account, WhatsApp Business App account, and WhatsApp Business Platform account are different product states. At implementation time, inspect Meta's current official onboarding/coexistence capabilities and eligibility requirements and design our UX around the actual supported flow.

Never use WhatsApp Web scraping, browser automation, QR-session theft, unofficial libraries, or other methods that bypass the official WhatsApp Business Platform.

## 7. Webhook architecture

Design the webhook boundary for retries and duplicates.

The webhook handler should:

1. perform the verification/authenticity checks required by Meta;
2. create a request/correlation ID;
3. validate the external payload at runtime;
4. identify the provider event/message ID;
5. use a durable idempotency mechanism;
6. persist enough information to avoid event loss;
7. acknowledge promptly;
8. move expensive processing out of the request path where justified;
9. fail safely without duplicating messages.

Do not rely on in-memory state to detect duplicates.

Unknown event/message types should be observable and safely ignored or recorded rather than taking down the entire webhook pipeline.

## 8. Error handling

Create a small application error system with:

- typed/stable error codes;
- safe user-facing messages;
- internal diagnostic context;
- structured logs;
- request/correlation IDs;
- provider error normalization;
- consistent API/route error responses;
- error boundaries for UI failures where appropriate.

Never send stack traces, SQL errors, access tokens, provider secrets, or patient message contents to the client.

Never silently swallow exceptions.

A useful internal failure record should answer:

```text
where did it fail?
what operation was being attempted?
which request/event was involved?
what category of failure occurred?
what safe context is available?
```

## 9. Observability and logging

Use structured logging from the beginning.

Log useful metadata such as:

- timestamp;
- severity;
- request/correlation ID;
- operation;
- provider event ID where appropriate;
- tenant/workspace ID only when safe and necessary;
- normalized error category.

Do not log:

- Meta access tokens;
- Supabase secret keys;
- Gemini keys;
- webhook secrets;
- full patient conversations;
- unnecessary PII.

Use synthetic data for tests and development.

## 10. Performance/scalability foundations

The first release does not need a complex distributed architecture, but it must avoid obvious problems.

Design for:

- many conversations per workspace;
- large message histories;
- paginated queries;
- proper indexes;
- Realtime updates scoped to authorized records;
- idempotent webhook processing;
- bounded concurrency for background jobs if/when added;
- retry-safe provider operations;
- no N+1 queries;
- no user-specific data in global mutable state;
- no full-history queries for list pages.

Do not introduce Redis/Kafka/Kubernetes/etc. unless a concrete later requirement warrants it.

## 11. Admin skeleton

Create only the basic administrative boundary for now:

- admin route group/page;
- authorization placeholder;
- placeholder navigation;
- future home for account approval/review tools.

Do not implement the full approval workflow yet.

## 12. Configuration and secrets

Create a typed configuration layer and `.env.example`.

Separate:

- public client configuration;
- server-only secrets;
- local development values;
- staging values;
- production values.

Never commit real credentials.

## 13. Documentation

Create or update:

`docs/architecture.md`

It should explain:

- application layers;
- feature boundaries;
- multi-tenant ownership;
- authorization/RLS;
- WhatsApp integration boundary;
- webhook lifecycle;
- error/observability strategy;
- environment/secrets strategy;
- testing layers.

Also update `README.md` with setup, commands, environment variables, architecture overview, current milestone, and security notes.

## 14. First implementation behavior

Before changing code:

1. inspect the existing repository;
2. inspect Git status/branch;
3. identify the existing framework and tooling;
4. identify existing Supabase setup;
5. preserve useful existing work;
6. identify conflicts with this architecture;
7. propose the minimal changes needed;
8. then implement the skeleton.

Do not rewrite the application just to impose a personal style.

Do not add dependencies without a concrete reason.

At the end of this prompt, verify:

- application starts;
- TypeScript passes;
- lint passes;
- tests pass;
- build passes;
- migrations are valid;
- no secrets were added;
- documentation exists.

Then STOP.

Do not begin WhatsApp functionality in this task. Report what was created, what was verified, and what the developer must manually test before moving to the next task.
