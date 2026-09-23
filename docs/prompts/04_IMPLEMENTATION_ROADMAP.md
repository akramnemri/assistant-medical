# Prompt 04 — Sequential Implementation Roadmap

Act as the senior implementation engineer.

Implement the project one bounded task at a time.

## Non-negotiable execution rule

Do NOT implement a whole phase in one response.
Do NOT silently move from one task to the next.

For every task:

```text
take one task
 -> implement it
 -> automated tests
 -> report results
 -> STOP
 -> developer manually tests
 -> developer reports result
 -> only then move to next task
```

Use the architecture and coding standards from the previous prompts.

## Final goal of the first milestone

The first milestone ends only when this works end to end:

```text
Doctor signs in
    -> connects an eligible WhatsApp Business / WhatsApp Business Platform number
    -> Meta sends a real inbound event
    -> webhook is verified/validated
    -> event is processed idempotently
    -> message is stored once
    -> message belongs to the correct workspace/conversation
    -> Supabase Realtime updates the browser
    -> message appears without refresh
```

Before this works reliably, do not spend major effort on AI, complex metrics, automation, or advanced admin functionality.

---

# PHASE 0 — Repository baseline

## Task 0.1 — Inspect the repository

Inspect:

- framework/version;
- package manager;
- current routes/components;
- Supabase setup;
- environment/configuration;
- testing/lint/build scripts;
- Git branches/status;
- existing implementation.

Do not rewrite working code just to impose a new structure.

Output:

- repository map;
- architectural conflicts;
- proposed task order.

Then STOP for the developer's approval if a major architectural decision is required.

## Task 0.2 — Baseline tooling

Establish or normalize:

- TypeScript strictness;
- linting;
- formatting if appropriate;
- test framework;
- build scripts;
- `.env.example`;
- `.gitignore`;
- README setup commands.

Automated:

- typecheck;
- lint;
- tests;
- build.

Manual:

- start the app;
- open the root page;
- confirm no startup/runtime error.

STOP.

---

# PHASE 1 — Application skeleton

## Task 1.1 — Route and feature skeleton

Create the basic route boundaries:

- auth;
- dashboard;
- conversations placeholder;
- WhatsApp connection placeholder;
- admin placeholder;
- settings placeholder.

Create feature boundaries and server/integration boundaries according to the architecture prompt.

Do not implement real WhatsApp behavior.

Automated:

- typecheck;
- lint;
- build.

Manual:

- visit all placeholder routes;
- confirm navigation works;
- confirm protected pages behave correctly if auth already exists.

STOP.

## Task 1.2 — Error/observability foundation

Implement:

- application error type;
- stable error codes;
- logger;
- request/correlation ID;
- safe error response format;
- Next.js/React error boundaries where appropriate.

Tests:

- expected AppError;
- unexpected exception;
- safe serialization;
- no secret/PII leakage.

Manual:

- intentionally trigger a development-only test error;
- verify user sees a safe message;
- verify logs are useful and do not expose secrets or message content.

STOP.

---

# PHASE 2 — Supabase/Auth foundation

## Task 2.1 — Supabase client/config setup

Implement:

- browser-safe client;
- server-side client;
- privileged server-only client only where genuinely required;
- environment validation;
- session helpers.

Use current Supabase key conventions rather than assuming old `anon/service_role` naming.

Automated:

- client/server initialization tests where practical;
- typecheck;
- build.

Manual:

- start with local configuration;
- verify app loads correctly;
- verify missing required configuration fails clearly in development.

STOP.

## Task 2.2 — Email/password authentication

Implement:

- sign up, if product requires open registration at this stage;
- sign in;
- sign out;
- session persistence;
- protected dashboard;
- authentication errors;
- loading states.

Tests:

- successful sign in;
- failed sign in;
- protected route;
- logout.

Manual:

- use a synthetic test account;
- sign in;
- refresh;
- sign out;
- verify protected route behavior.

STOP.

## Task 2.3 — Workspace/tenant model

Implement minimum models for:

- profile;
- doctor/workspace/business;
- membership/role relationship where required.

Add:

- foreign keys;
- indexes;
- RLS;
- database tests for allow/deny behavior.

Manual:

- create two synthetic accounts/workspaces;
- verify complete data isolation.

STOP.

---

# PHASE 3 — Conversation database foundation

## Task 3.1 — WhatsApp connection model

Model:

- workspace ownership;
- provider identifiers;
- phone number identity;
- WABA/account identity where needed;
- connection status;
- timestamps;
- lifecycle/error state.

Do not model the connection as simply "phone number + token".

Do not expose provider credentials to the browser.

Tests:

- workspace ownership;
- uniqueness;
- allowed state transitions.

Manual:

- inspect records for multiple synthetic workspaces;
- verify no cross-tenant access.

STOP.

## Task 3.2 — Conversations/messages schema

Create the first internal model for:

- conversations;
- contacts/patient identities as needed;
- messages;
- direction;
- message timestamps;
- provider IDs;
- status fields required by MVP;
- workspace/connection ownership.

Use database constraints to prevent duplicates where the provider identifier is unique.

Tests:

- relationships;
- uniqueness/idempotency constraints;
- ordering;
- pagination;
- RLS isolation.

Manual:

- create synthetic messages and conversations;
- verify only the correct workspace sees them.

STOP.

## Task 3.3 — Conversation data service

Implement readable server-side functions for:

- list conversations;
- fetch one conversation;
- fetch messages with cursor/offset pagination as appropriate;
- unread counts only where needed.

Do not implement complex filters/metrics yet.

Tests:

- ordering;
- pagination;
- authorization;
- empty result;
- invalid identifier.

Manual:

- verify conversation list and message retrieval with synthetic data.

STOP.

---

# PHASE 4 — Conversation UI

## Task 4.1 — Conversation list UI

Implement:

- conversation list;
- latest message preview;
- timestamps;
- unread indicator;
- loading state;
- empty state;
- error state.

Do not implement advanced organization yet.

Tests:

- empty/loading/error states;
- authorized data only.

Manual:

- test desktop and mobile layouts;
- change synthetic data and confirm expected update behavior.

STOP.

## Task 4.2 — Conversation thread UI

Implement:

- incoming/outgoing message distinction;
- chronological ordering;
- pagination/infinite loading;
- loading states;
- error states.

Do not add Gemini yet.

Tests:

- ordering;
- duplicate rendering prevention;
- pagination behavior.

Manual:

- open a conversation containing many synthetic messages;
- verify no obvious missing/duplicate messages.

STOP.

## Task 4.3 — Realtime before Meta

Prove that the frontend can display a newly-created database message without a page refresh.

Use Supabase Realtime or the final chosen realtime mechanism.

Manual:

1. Open the conversation in browser A.
2. Create a synthetic new message through browser B or a controlled development mechanism.
3. Confirm browser A updates automatically.

STOP.

This isolates realtime problems before Meta is introduced.

---

# PHASE 5 — Meta onboarding

## Task 5.1 — Verify current official Meta requirements

Before writing provider-specific onboarding code, inspect the current official Meta documentation available at implementation time.

Confirm:

- Embedded Signup flow;
- current permissions/scopes;
- app configuration;
- business/account requirements;
- phone registration requirements;
- webhook requirements;
- supported WhatsApp Business App/coexistence paths, if applicable;
- current API/version details.

Do not trust remembered API versions or old tutorials.

Document verified requirements in:

`docs/integrations/whatsapp.md`

Critical UX rule:

Do not tell users that they can simply "merge a personal WhatsApp account into a Business account" unless Meta's current official product flow actually supports that exact action.

Instead, guide users according to their current state:

- personal WhatsApp;
- WhatsApp Business App;
- WhatsApp Business Platform.

If migration/coexistence is unsupported for a given state, explain the supported alternative rather than inventing one.

STOP after documentation if the required Meta configuration is not yet available.

## Task 5.2 — WhatsApp connection UI

Build:

- connection page;
- connection status;
- onboarding entry point;
- helpful setup instructions;
- success/error/retry states;
- disconnect state placeholder.

The UI must never request unnecessary secrets from users.

Manual:

- inspect the entire onboarding flow;
- verify wording is accurate and understandable;
- verify no credential is rendered to the browser.

STOP.

## Task 5.3 — Server-side onboarding completion

Implement the server-side callback/exchange required by the verified Meta flow.

Requirements:

- trusted server boundary;
- secure credential handling;
- correct workspace association;
- retry/recovery where reasonable;
- idempotent handling of repeated completion callbacks;
- clear connection state.

Tests:

- valid completion;
- invalid completion;
- wrong workspace/context;
- duplicate completion;
- provider error.

Manual:

- complete the official test/sandbox onboarding flow.

STOP.

---

# PHASE 6 — Inbound WhatsApp webhook

## Task 6.1 — Webhook verification

Implement the webhook verification procedure required by the current Meta API.

Tests:

- valid verification;
- invalid verification;
- unexpected requests.

Manual:

- configure Meta test webhook;
- confirm verification succeeds.

STOP.

## Task 6.2 — Secure webhook receiver

Implement the actual webhook endpoint.

Requirements:

1. verify authenticity/signature according to current Meta requirements;
2. validate JSON/payload structure at runtime;
3. assign correlation ID;
4. identify connection/workspace correctly;
5. perform durable idempotency checks;
6. persist event/message safely;
7. acknowledge quickly;
8. keep heavy work out of the request path when appropriate;
9. handle malformed or unsupported events without crashing the endpoint.

Tests:

- valid event;
- malformed payload;
- invalid signature/authenticity;
- duplicate event;
- duplicate message;
- batch containing multiple events;
- unsupported message type;
- provider retry.

Manual:

- send a real test WhatsApp message;
- confirm the webhook receives it;
- confirm the event is stored/processed exactly once.

STOP.

## Task 6.3 — Normalize inbound messages

Convert the Meta-specific payload into the internal message model.

Keep provider-specific details inside the Meta integration layer.

Implement only the message types required for the first mini-demo.

Unknown message types should be safely observable and must not crash the entire webhook pipeline.

Tests:

- supported message;
- missing optional values;
- duplicate message;
- unknown message type;
- malformed content.

Manual:

- send the supported test message types;
- inspect the resulting internal records.

STOP.

---

# PHASE 7 — First end-to-end mini demo

## Task 7.1 — Connect provider event to conversation UI

Complete:

```text
Meta webhook
 -> normalized internal message
 -> correct workspace
 -> correct conversation
 -> single database record
 -> Realtime event
 -> authenticated browser update
```

Automated tests:

- inbound event integration test;
- duplicate delivery;
- cross-tenant access;
- correct conversation creation/reuse;
- message ordering;
- failure/retry paths.

Manual end-to-end test:

1. Sign in as Doctor A.
2. Connect Doctor A's supported WhatsApp number using the official flow.
3. Open the conversation interface.
4. From a real test phone/account, send a WhatsApp message to the connected number.
5. Confirm Meta reaches the webhook.
6. Confirm the internal message is inserted once.
7. Confirm it belongs to Doctor A's workspace.
8. Confirm the browser displays it automatically without refresh.
9. Send another message.
10. Verify both messages are correctly ordered.
11. Trigger/reproduce duplicate delivery if your test setup permits it.
12. Verify no duplicate message is created.

STOP.

## Task 7.2 — First milestone hardening

Before promoting the first mini-demo:

- verify RLS policies;
- inspect indexes;
- verify idempotency constraints;
- verify webhook retry behavior;
- verify safe errors/logs;
- verify no secrets are committed or exposed;
- verify no patient/real-world data appears in fixtures/logs;
- check concurrent activity from multiple synthetic users;
- run full typecheck/lint/tests/build;
- run relevant E2E/integration tests;
- verify deployment configuration.

Then execute the full manual smoke test again.

STOP.

At this point the first milestone may be considered for `develop -> main` promotion according to the Git/testing prompt.

---

# Features explicitly deferred until the first milestone is stable

Do NOT implement these before the inbound pipeline is reliable unless a small dependency is required:

- advanced conversation metrics;
- labels/tagging;
- sophisticated search;
- automated menu bot;
- Gemini-generated replies;
- patient classification using AI;
- bulk messaging;
- appointment automation;
- full admin approval workflows;
- advanced analytics.

The first priority is a trustworthy inbound message pipeline.

---

# Post-MVP roadmap

After the first milestone, continue with independently testable milestones, for example:

1. outbound WhatsApp messaging;
2. delivery/read status synchronization;
3. team members and conversation assignment;
4. labels and manual organization;
5. search/filtering;
6. deterministic FAQ/menu bot;
7. provider-independent AI interface;
8. Gemini-assisted features;
9. admin account approval/review;
10. audit/retention/deletion controls;
11. background-job/queue processing where load justifies it;
12. rate limiting and production observability;
13. billing/quotas if the product becomes multi-plan SaaS.

Every post-MVP feature follows:

```text
bounded task
 -> automated tests
 -> STOP
 -> manual developer test
 -> integration
 -> regression check
 -> next bounded task
```

## Mandatory completion report for every task

At the end of every task, respond with exactly this structure:

```text
TASK COMPLETED

What changed:

Files changed:

Database/migration changes:

Automated checks run:

Manual test steps:

Expected result:

Known limitations/issues:

Next task:
```

Then STOP and wait for the developer's manual-test result.

Never silently continue to the next task.
