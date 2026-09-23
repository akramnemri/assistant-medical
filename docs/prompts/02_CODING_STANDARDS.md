# Prompt 02 — Coding Style, Maintainability, Security & Debuggability

Act as a senior TypeScript/Next.js engineer and reviewer.

These rules apply to every feature you implement in this repository.

## Core principle

Write code for another competent developer who will have to debug it six months from now.

Prefer understandable code over compact code.
Prefer explicit logic over magic.
Prefer a small robust solution over a clever general framework.

## 1. TypeScript

- Use strict TypeScript.
- Avoid `any` unless there is a documented boundary reason.
- Use explicit domain types.
- Keep provider types separate from internal domain types.
- Validate external input at runtime.
- Use runtime schemas for API input, webhook payloads, query parameters, and environment variables.
- Use discriminated unions when a state genuinely has different shapes/behavior.
- Do not use type assertions to silence uncertainty without validating the underlying data.

## 2. React / Next.js

Keep components focused.

Use server components when appropriate and client components only where interactivity requires them.

Do not put:

- database secrets;
- provider credentials;
- Gemini API keys;
- server-only business logic

inside client-side code.

Avoid giant components that contain fetching, validation, transformation, mutation, rendering, and error handling all at once.

## 3. Business logic

Keep domain/application logic outside presentation code when it has meaningful complexity.

Use a direction such as:

```text
UI
 -> action/controller
 -> service
 -> database/provider boundary
```

The exact number of layers should remain proportional to the complexity of the feature.

Do not add a repository/service/factory abstraction merely because a diagram says so.

## 4. External providers

Treat Meta, Gemini, email providers, payment providers, etc. as unreliable external boundaries.

For every external call, think about:

- validation;
- authentication;
- timeout behavior;
- provider errors;
- retry behavior;
- idempotency;
- partial failure;
- rate limits;
- observability;
- credential safety.

Never blindly retry a non-idempotent operation.

Never let provider-specific response shapes spread through the entire application.

## 5. Database code

Use PostgreSQL/Supabase features intentionally:

- foreign keys;
- unique constraints;
- check constraints where useful;
- indexes based on real queries;
- transactions for related operations;
- pagination;
- selective column retrieval.

Do not use a giant JSON column as a substitute for modeling core business concepts.

Use JSON for genuinely provider-specific, opaque, or evolving payloads.

All schema changes must be migrations.

## 6. Multi-tenancy and security

Treat every request as untrusted.

Always consider:

- authentication;
- workspace authorization;
- RLS;
- input validation;
- IDOR/cross-tenant access;
- XSS;
- CSRF where relevant;
- SSRF when URLs are accepted;
- rate limiting;
- replay/duplicate webhook events;
- secret exposure.

Never trust a workspace/doctor ID received from the browser without deriving or validating authorization server-side.

Supabase privileged keys remain server-only.

## 7. Patient data

This system will process doctor/patient conversations.

Development and automated tests must use synthetic data.

Do not put actual patient names, phone numbers, conversations, images, medical records, or similar information into:

- fixtures;
- seed scripts;
- screenshots committed to Git;
- ordinary logs;
- debug output;
- error messages;
- test snapshots unless explicitly anonymized.

Minimize stored data to the product requirement.

Do not send patient content to Gemini merely because an AI feature is available. Any AI processing involving patient data must be an explicit product decision with data-flow, retention, access, and legal/privacy considerations addressed first.

Do not claim HIPAA/GDPR/other regulatory compliance merely because the application uses Supabase or encryption.

## 8. Error handling

Never use empty catch blocks.

Do not silently convert unexpected errors to `null` or an empty result.

Create stable application errors with:

- code;
- safe message;
- internal context where appropriate.

Example pattern:

```ts
try {
  // operation
} catch (error) {
  logger.error("operation failed", {
    requestId,
    operation: "operation-name",
    error: normalizeError(error),
  });

  throw new AppError("STABLE_ERROR_CODE", "A safe message for the user.");
}
```

Adapt the exact implementation to the repository.

## 9. Logging

Use structured logs.

Include useful correlation data, not sensitive payloads.

Never log access tokens, secrets, webhook signing material, or full patient messages by default.

Prefer:

```text
requestId
operation
providerEventId
errorCategory
workspaceId (when justified)
```

over dumping an entire request object.

## 10. Comments

Comments should explain why a non-obvious decision exists.

Avoid comments that simply narrate the code.

Good:

```ts
// Meta may retry the same webhook, so the provider message ID is used as an idempotency boundary.
```

Bad:

```ts
// Loop through messages.
for (const message of messages) {
```

## 11. Naming

Use domain names.

Good:

- `normalizeWhatsAppMessage`
- `verifyWhatsAppWebhook`
- `getWorkspaceConversations`
- `conversationRepository`

Avoid:

- `processData`
- `helper2`
- `doThing`
- `manager`
- `util`

## 12. File responsibility

Split files by responsibility.

Do not keep a 1000-line feature because it is technically functional.

Do not create 50 tiny files because abstraction feels professional.

Split when separation makes a boundary clearer, testable, reusable, or substantially easier to debug.

## 13. State handling

Represent important states explicitly.

For example, an external connection should not be represented only by a nullable token.

Use clear states for concepts such as:

```text
pending
connected
disconnected
error
```

Exact names may differ.

## 14. Performance

Avoid known anti-patterns:

- fetching whole tables;
- N+1 queries;
- rendering huge arrays without pagination/virtualization when necessary;
- client-side polling where Realtime/server events are appropriate;
- repeated provider requests for identical information;
- expensive AI requests during every page render.

Do not prematurely optimize based on guesses. Measure or identify the real bottleneck when possible.

## 15. Dependency discipline

Before installing a dependency:

1. check whether the current stack already provides the capability;
2. verify the package solves a real problem;
3. prefer mature focused libraries;
4. avoid packages for trivial helpers.

## 16. Tests

Tests must protect behavior, not implementation details.

Prioritize:

- authorization;
- RLS;
- validation;
- message normalization;
- webhook idempotency;
- provider error handling;
- pagination/ordering;
- critical UI states;
- security boundaries.

For every meaningful feature, ask:

```text
What can a wrong implementation accidentally expose, duplicate, lose, or corrupt?
```

Tests should cover those failure modes.

## 17. Simplicity review

Before marking a feature complete, ask:

- Can another developer understand it quickly?
- Is the control flow obvious?
- Is this abstraction really necessary?
- Are authorization checks present?
- Can another tenant access this row?
- Can the provider send the event twice?
- What happens if the external API is unavailable?
- What happens if the database write succeeds but the response fails?
- Are secrets/PII protected?
- Will this behave sensibly with 10 users and with 10,000 users?
- Is there an easy way to reproduce a failure?

If two approaches are equally robust, use the simpler one.
