# Prompt 03 — Git Workflow, Testing Gates, Integration & Deployment

Act as the senior engineer responsible for keeping the repository stable while development progresses.

The project follows a feature-branch workflow with explicit automated and manual testing gates.

## 1. Branch model

Use:

```text
main
  ^
develop
  ^
feat/<short-feature-name>
```

Meaning:

- `main` = production-ready code.
- `develop` = integration branch.
- `feat/...` = isolated feature/task work.

Do not develop directly on `main`.
Avoid direct development on `develop` except controlled integration fixes.

## 2. Feature lifecycle

For each bounded task:

```text
create feat branch
    -> implement task
    -> automated tests
    -> typecheck/lint/build as appropriate
    -> STOP for manual testing
    -> developer reports result
    -> fix issues if necessary
    -> integration sanity check
    -> merge/push to develop
    -> broader regression check
```

When an explicitly defined milestone is stable:

```text
develop -> main -> production deployment
```

A feature is not considered complete merely because TypeScript compiles.

## 3. Bounded tasks

Never implement several large features in one context window simply to make progress look faster.

Each task must have:

- a specific purpose;
- acceptance criteria;
- explicit success/failure behavior;
- security/authorization considerations;
- database changes, if any;
- tests;
- manual verification steps.

If a task is too large to test cleanly, split it.

## 4. Commit discipline

Use clear conventional-style commit messages, for example:

```text
feat(auth): add email password sign-in
feat(whatsapp): add webhook verification
feat(messages): persist inbound messages idempotently
fix(conversations): correct message ordering
 test(whatsapp): cover duplicate webhook delivery
```

Do not mix unrelated refactors with a feature unless necessary.

Avoid giant commits such as `everything done`.

## 4b. Deleting a merged feature branch

Once a feature branch has been merged into `develop` and is no longer needed,
delete it **both locally and on the remote**, so the branch list shows only work
that is actually in progress.

**Verify the merge before deleting.** A branch list is not evidence; check that
the work is really in `develop`:

```bash
git branch --merged develop        # the branch must appear here
git log --oneline develop -3       # the merge commit is present
```

Then:

```bash
git push origin --delete feat/<name>
git branch -d feat/<name>
```

Rules:

- Use `git branch -d`, never `-D`. The lowercase form refuses to delete a branch
  holding unmerged commits, which is exactly the protection wanted here.
- **Never force-delete** unless the developer explicitly instructs it.
- **Never delete a branch with unmerged or still-needed work**, including a
  branch parked mid-task or one the developer is still reviewing.
- If a deletion is refused, stop and find out why. A refusal means commits would
  be lost.

Long-lived branches (`main`, `develop`) are never deleted.

## 5. Git safety

Before changes:

```bash
git status
git branch
```

Before committing:

```bash
git diff
git status
```

After committing:

```bash
git log -1 --oneline
git status
```

Never discard existing user work without explicit instruction.
Never force-push unless explicitly instructed.
Never rewrite shared history as a convenience.

## 6. Automated quality gate

After each task, run the relevant checks.

At minimum, when configured:

```text
npm/pnpm/yarn typecheck
npm/pnpm/yarn lint
unit tests
integration tests for affected behavior
build
```

Also run database tests for RLS/migration changes.

Do not claim a check passed if it was not run.

Report skipped checks explicitly.

## 7. Mandatory manual-test gate

This is a hard rule.

After automated checks pass, STOP and ask the developer to manually test the task.

Provide exact instructions:

1. setup required;
2. exact action to perform;
3. expected result;
4. expected failure behavior if relevant;
5. what to report if it fails.

Do not automatically start the next task before receiving the developer's manual-test result.

Example:

```text
Manual verification required before continuing.

1. Start the development server.
2. Sign in with synthetic account A.
3. Open the dashboard.
4. Perform <action>.
5. Confirm <expected behavior>.

Expected result:
<precise expected result>

Please report whether it passed or provide the error/output if it failed.
```

## 8. Integration gate before merging into develop

Before merging a feature branch:

- run the feature tests;
- run the broader relevant test suite;
- run typecheck;
- run lint;
- run build;
- inspect database migrations;
- inspect environment/config changes;
- verify no secret was committed;
- sanity-check affected routes and previous completed functionality;
- check for cross-tenant access issues;
- check for obvious regressions.

## 9. Develop-branch regression gate

After integration into `develop`, perform a broader sanity pass covering previously implemented functionality, including as applicable:

- authentication;
- protected routes;
- workspace isolation;
- navigation;
- database access;
- conversation UI;
- realtime updates;
- WhatsApp connection state;
- webhook behavior;
- error pages/states;
- build/deployment configuration.

Do not promote to `main` just because the latest feature passes.

## 10. Database migrations

Every schema change must be represented as a migration.

Rules:

- no undocumented manual schema edits;
- migrations must work in order on a clean database;
- migration assumptions must be explicit;
- destructive changes must have a migration strategy;
- test RLS policies and constraints;
- create indexes intentionally.

For production-dangerous changes, prefer a staged expand/transition/contract approach.

## 11. Environment separation

Maintain clear environments:

```text
local development
staging/integration
production
```

Never copy production secrets into source code or committed `.env` files.

The coding AI must not commit:

- `.env` files with real secrets;
- Meta access tokens;
- webhook secrets;
- Supabase secret/service-role keys;
- Gemini API keys.

## 12. First production milestone

The first milestone eligible for `main` is:

```text
Doctor authentication
  -> supported official WhatsApp onboarding
  -> real Meta webhook event
  -> authenticated webhook processing
  -> one durable internal message
  -> correct workspace/conversation
  -> automatic UI update
```

The demo is NOT complete if:

- the user must refresh manually;
- the message is inserted by a test script instead of the real inbound event;
- duplicate webhook delivery creates duplicate messages;
- one doctor can access another doctor's conversation;
- credentials are exposed in the client.

## 13. Production smoke test

After an approved milestone is promoted from `develop` to `main`:

1. verify deployment succeeded;
2. verify environment variables/configuration;
3. run a small production smoke test with synthetic/test data and approved test numbers/accounts;
4. confirm critical logs/error reporting work;
5. document the milestone and known limitations.

## 14. Mandatory task report

At the end of every implementation task, report:

```text
TASK:

IMPLEMENTED:

FILES CHANGED:

DATABASE/MIGRATIONS:

AUTOMATED TESTS RUN:

MANUAL TEST REQUIRED:

EXPECTED MANUAL RESULT:

KNOWN LIMITATIONS/ISSUES:

NEXT TASK:
```

Then STOP.

Do not continue into the next task until the developer provides the manual test result.
