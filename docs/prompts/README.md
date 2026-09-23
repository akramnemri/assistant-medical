# Doctor WhatsApp Platform — AI Development Prompt Pack

These prompts are intended to be given to a coding AI in sequence.

## Files

1. `01_ARCHITECTURE.md` — architecture, project structure, multi-tenancy, RLS, webhook boundary, errors, observability, scalability, and initial skeleton.
2. `02_CODING_STANDARDS.md` — readable code, TypeScript/Next.js conventions, security, patient-data handling, provider isolation, testing, and maintainability rules.
3. `03_GIT_TESTING_PIPELINE.md` — feat -> manual test -> develop -> regression -> main -> production workflow, including deleting merged feature branches.
4. `04_IMPLEMENTATION_ROADMAP.md` — sequential implementation plan from repository inspection to the first real WhatsApp-to-site mini-demo.
5. `05_SESSION_CONTINUITY.md` — handing over between AI coding sessions: treat the repository as the source of truth, distinguish implemented / automatically tested / manually verified / not yet verified, and keep `docs/project-state.md` current.

These files live in `docs/prompts/` **inside the repository**, so a new session
inherits them by opening the project. That is the point: a prompt pack that
lives only on someone's desktop is not available to the session that needs it.

## Recommended execution order

**Starting a new session on work already in progress?** Read
`05_SESSION_CONTINUITY.md` first, then `docs/project-state.md`. Do not begin
anything until you know where the previous session stopped and whether it was
waiting on a manual test.

For a project being started from nothing:

Give Prompt 01 first and let the AI inspect and create the skeleton.

Then treat Prompt 02, Prompt 03 and Prompt 05 as persistent project
instructions.

Then use Prompt 04 as the execution roadmap. The AI must implement one task at a
time and stop for manual testing after every task.

## First milestone

The first meaningful demo is:

```text
Doctor login
 -> official WhatsApp onboarding
 -> real inbound WhatsApp message
 -> Meta webhook
 -> safe/idempotent server processing
 -> Supabase message record
 -> correct workspace/conversation
 -> realtime browser update
```

The milestone is not complete if the message only appears after refresh, if it is manually inserted, if duplicates appear on webhook retry, or if tenant isolation is not proven.

## Important WhatsApp product distinction

Do not design the product around the assumption that a normal personal WhatsApp account can simply be "merged" into a Business account by our application.

The onboarding experience must distinguish personal WhatsApp, WhatsApp Business App, and WhatsApp Business Platform. At implementation time, verify the current official Meta onboarding/coexistence options and eligibility rules and adapt the UX to those actual rules.

Avoid unofficial WhatsApp Web automation/scraping.

## Security/product notes

Because the platform handles doctor/patient conversations:

- use synthetic data in development and testing;
- keep credentials server-side;
- use RLS for tenant isolation;
- avoid sensitive data in logs;
- design auditability, retention/deletion, access control, and incident handling before production;
- do not assume regulatory compliance without a real legal/security assessment;
- do not send patient content to an AI provider without an explicit data-flow and privacy decision.
