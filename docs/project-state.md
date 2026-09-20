# Project state

Handoff note for the next session. **Verify these claims against the repository
before relying on them** — see `docs/prompts/05_SESSION_CONTINUITY.md`.

**Last updated:** 2026-09-20, end of Task 5.3.

---

## Where development stopped

|                |                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| **Milestone**  | First milestone: a trustworthy inbound WhatsApp message pipeline                                              |
| **Phase**      | 5 (Meta onboarding) complete; Phase 6 (webhooks) not started                                                  |
| **Last task**  | **Task 5.3 — server-side onboarding completion**                                                              |
| **Task state** | **Implemented and automatically tested. NOT manually verified, and not verifiable without Meta credentials.** |
| **Branch**     | `develop`, clean tree                                                                                         |
| **Next task**  | **Task 6.1 — webhook verification** (the `GET` handshake)                                                     |

### Manual testing

The developer **waived** the manual-test gate for Tasks 5.2 and 5.3 in the
previous session ("continue i didn't test"). That waiver applied to that
session only.

Before starting Task 6.1, **ask whether the developer wants to manually test
5.2/5.3 first, or waive again**. Do not assume.

---

## Verification status

The four states are defined in `docs/prompts/05_SESSION_CONTINUITY.md`. Nothing
below is _manually verified_ unless it says so.

| Area                               | State                                                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Auth, workspaces, RLS              | implemented · auto-tested · **manually verified**                                                                    |
| Conversation list and thread       | implemented · auto-tested · **manually verified**                                                                    |
| Realtime message delivery          | implemented · auto-tested · **manually verified** (browser: 60→61 messages, no reload)                               |
| WhatsApp connection model + UI     | implemented · auto-tested · **not manually verified**                                                                |
| **Meta onboarding exchange (5.3)** | implemented · auto-tested against a **mocked** provider · **NOT VERIFIED — never called with real Meta credentials** |
| Webhooks (Phase 6)                 | **not implemented**                                                                                                  |
| Outbound messaging                 | **not implemented**                                                                                                  |
| Deployment                         | **not implemented** — never deployed anywhere                                                                        |

### Automated checks — last run 2026-09-20, all passing

```
npm run verify      typecheck, lint, format, 219 unit+integration tests, build
npm run db:test     90 pgTAP assertions across 3 files
npm run test:e2e    35 Playwright tests
```

`db:test`, `test:e2e` and the integration tests **require the local Supabase
stack**. The integration suites skip themselves when it is unreachable — a
green run with skipped suites verifies less than it appears to, so **check the
counts**. A run reporting "193 passed | 26 skipped" means Docker was down and
nothing touching the database was actually verified.

Known flake: `tests/integration/realtime-messages.test.ts` can fail on the
**first run after the stack restarts**, because Realtime needs a moment before
it serves Postgres Changes. Re-run before investigating.

---

## Git

- `develop` holds all work. **`main` is still at the initial commit, 33 commits
  behind.** Nothing has ever been promoted, which is correct: per
  `03_GIT_TESTING_PIPELINE.md` promotion happens only when the first milestone
  is stable, and the inbound pipeline does not exist yet.
- Remote has only `origin/develop` and `origin/main`. Feature branches are
  deleted after merging.

---

## Database

Local Supabase via Docker. **Docker Desktop does not start automatically on this
machine** — start it first, or `npx supabase start` fails with exit code 4 and
no useful output.

Five migrations, applied in order:

1. `workspace_tenant_model` — profiles, workspaces, workspace_members, RLS
2. `whatsapp_connection_model` — connections + secrets, lifecycle transitions
3. `conversations_messages` — contacts, conversations, messages
4. `conversation_list_view` — inbox view (`security_invoker`)
5. `enable_realtime_messages` — realtime publication

`npm run db:reset` recreates everything and re-seeds. **Regenerate types after
any migration:** `npm run db:types`. Nothing enforces this.

### Seeded accounts (synthetic, local only)

| Account                 | Password         | State                                           |
| ----------------------- | ---------------- | ----------------------------------------------- |
| `doctor-a@example.test` | `devpassword123` | connected number, 2 conversations, ~73 messages |
| `doctor-b@example.test` | `devpassword123` | pending connection, no conversations            |

Two accounts exist because tenant isolation cannot be checked with one.

---

## WhatsApp / Meta integration

**No Meta developer account exists.** This is the blocker for the rest of
Phase 5 and all of Phase 6.

Verified against Meta's live documentation on 2026-09-20 and recorded in
`docs/integrations/whatsapp.md`:

- Graph API **v26.0**; Embedded Signup **v2 deprecated ~Oct 2026, use v4**
- **Personal WhatsApp cannot be connected.** The UI must never offer to merge,
  convert or upgrade one — no such action exists.
- **Coexistence is not being used** (decided by the developer: "the free
  version"). Consequence: a doctor on the WhatsApp Business app **loses their
  message history** when connecting. The UI says so before they commit.
- Messaging is **free** for the core flow — a patient messages first, opening a
  customer service window in which replies cost nothing.

Built and unverified: `src/server/integrations/meta/client.ts` (token exchange,
phone number verification) and `src/server/services/whatsapp-onboarding.ts`.

**Highest-risk unknowns** if Task 5.3 is ever exercised for real: the exact
token-exchange response shape, whether `grant_type=authorization_code` is
correct for Embedded Signup's code, and the real error codes.

### Needed before Phase 6 can be finished

1. A Meta developer app with WhatsApp added
2. A Meta Business portfolio
3. **A public HTTPS endpoint** — Meta rejects self-signed certificates and will
   not deliver to `localhost`. A tunnel or a deployed preview is required.
4. A test phone number (Cloud API provides one free)

Task 6.1 (webhook verification) **can be built and tested without any of this**
— it only needs a verify token we choose.

---

## Known limitations and bugs

Ordered by how much they matter.

**Authorization**

- `/admin` is reachable by **any signed-in user**. Roles exist and gate
  workspace updates, but no route checks them. Largest open gap.

**Conversations**

- Nothing marks a conversation read; `unread_count` only grows.
- `unread_count` is workspace-level, not per-user. Correct for one doctor;
  **wrong**, not merely incomplete, once team members exist.
- The conversation list is unpaginated and not realtime — it needs a reload to
  re-order or update badges.
- A thread opens at the top, not scrolled to the newest message.
- No send box; outbound messages render but cannot be composed.

**Realtime**

- The subscription takes several seconds to go live after page load. A message
  arriving in that window is missed until reload. There is no reconnect
  backfill.

**Meta**

- No Embedded Signup launcher — the server side is ready, but nothing in the
  browser can start the flow. Needs Meta's JS SDK and a real app id.
- No token refresh; `token_expires_at` is stored but nothing acts on it.
- Access tokens are stored **in plaintext**, isolated by RLS and revoked
  privileges. Worth Supabase Vault before production.

**Other**

- Media messages are modelled but not storable — no URL or MIME columns.
- Patient message content is unencrypted beyond what Postgres provides.
- `/api/dev/*` routes exist and 404 in production; `/api/dev/conversations`
  returns message text and `/api/dev/messages` writes with the secret key.
- The `notFound()` path on a conversation returns **200 with a 404 page**
  because the route streams. Renders correctly and leaks nothing; the status
  line is already sent.
- Some tests depend on exact seed values. If the seed changes, they break.

---

## Next task

**Task 6.1 — Webhook verification** (`04_IMPLEMENTATION_ROADMAP.md`).

Implement the `GET` handshake at the webhook endpoint:

- Meta sends `hub.mode`, `hub.verify_token`, `hub.challenge`
- **Validate the token before echoing the challenge.** Echoing unconditionally
  lets anyone attach a webhook.
- Echo `hub.challenge` verbatim on success
- Tests: valid verification, invalid token, missing parameters, unexpected
  requests

Fully buildable and testable now — it needs only `META_WEBHOOK_VERIFY_TOKEN`,
which we choose. Details in `docs/integrations/whatsapp.md`.

**First**, resolve the outstanding manual-test question above.
