# Project state

Handoff note for the next session. **Verify these claims against the repository
before relying on them** — see `docs/prompts/05_SESSION_CONTINUITY.md`.

**Last updated:** 2026-09-20, end of Task 6.3.

---

## Where development stopped

|                |                                                                                 |
| -------------- | ------------------------------------------------------------------------------- |
| **Milestone**  | First milestone: a trustworthy inbound WhatsApp message pipeline                |
| **Phase**      | 5 (Meta onboarding) complete; Phase 6 (webhooks) started                        |
| **Last task**  | **Task 6.3 — normalise inbound messages into conversations**                    |
| **Task state** | **Implemented, automatically tested, verified end to end locally. Not merged.** |
| **Branch**     | **`feat/inbound-message-normalization`**, ahead of `develop`                    |
| **Next task**  | **Task 7.1 — prove the pipeline with a real Meta message**                      |

### Manual testing

Tasks 5.2 and 5.3 have **never been manually tested**. The gate was waived for
them in one earlier session, and Task 6.1 was then started without re-asking —
the session read "continue next task" as the go-ahead. 5.3 is in any case not
manually verifiable without Meta credentials, but **5.2 (the connection UI) is**
and remains outstanding.

Task 6.1 was manually exercised against the local dev server on 2026-09-20 —
all five steps plus the POST-405 case and the signed-out redirect. That covers
our half of the handshake; it does **not** cover Meta's, which still needs a
public HTTPS URL and a Meta app.

---

## Verification status

The four states are defined in `docs/prompts/05_SESSION_CONTINUITY.md`. Nothing
below is _manually verified_ unless it says so.

| Area                               | State                                                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Auth, workspaces, RLS              | implemented · auto-tested · **manually verified**                                                                     |
| Conversation list and thread       | implemented · auto-tested · **manually verified**                                                                     |
| Realtime message delivery          | implemented · auto-tested · **manually verified** (browser: 60→61 messages, no reload)                                |
| WhatsApp connection model + UI     | implemented · auto-tested · **not manually verified**                                                                 |
| **Meta onboarding exchange (5.3)** | implemented · auto-tested against a **mocked** provider · **NOT VERIFIED — never called with real Meta credentials**  |
| **Webhook verification (6.1)**     | implemented · auto-tested · **manually verified locally** (curl + browser) · never received a **real Meta** handshake |
| **Webhook receiver (6.2)**         | implemented · auto-tested · **verified locally** with signed payloads · never received a **real Meta** delivery       |
| **Inbound normalisation (6.3)**    | implemented · auto-tested · **verified locally** end to end, message visible in the browser inbox                     |
| Outbound messaging                 | **not implemented**                                                                                                   |
| Deployment                         | **not implemented** — never deployed anywhere                                                                         |

### Automated checks — last run 2026-09-20, all passing

```
npm run verify      typecheck, lint, format, 289 unit+integration tests, build
npm run db:test     90 pgTAP assertions across 3 files
npm run test:e2e    35 Playwright tests
```

The 289 figure had **no skipped suites**, so the Supabase-dependent tests
genuinely ran.

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

- `develop` holds all merged work; `feat/webhook-verification` holds Task 6.1
  and is **not merged yet**. **`main` is still at the initial commit, 33 commits
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

Task 6.1 (webhook verification) was built and automatically tested **without any
of this** — it only needs a verify token we choose. Confirming it against a real
Meta handshake still needs items 1 and 3.

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

- **The verify token appears in request logs.** Meta puts it in the query
  string, so Next's dev request log — and Vercel's access log in production —
  records the full URL including `hub.verify_token`. Nothing in our code logs
  it, and there is no way to stop Meta sending it this way. Consequences:
  treat the token as visible to anyone who can read hosting logs, keep it
  distinct from `META_APP_SECRET`, and rotate it if logs are ever shared.
- **The test suites assume each seeded workspace has exactly one WhatsApp
  connection.** Connecting a real number locally adds a second and breaks the
  pgTAP suite (`more than one row returned for \gset`) and one Playwright spec,
  with errors that point nowhere near the cause. This bit twice during Task 6.2.
  Clean up demo connections, or fix the fixtures before the real Meta test.
- **Media messages store only the caption.** There are no URL or MIME columns,
  so an image or voice note arrives as a row with the right type and no way to
  open it. Enough to prove the pipeline; not enough for a doctor.
- **Processing runs inside the request.** Fine at current volume, but Meta
  batches up to 1000 updates and expects a prompt acknowledgement. A large batch
  could time out, which Meta then retries — safely, because of the idempotency
  digest, but slowly.
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

## What Task 6.1 built

- `src/server/integrations/meta/webhook-verification.ts` — the handshake
  decision as a pure function over the query string. Timing-safe token
  comparison; fails closed when `META_WEBHOOK_VERIFY_TOKEN` is unset.
- `src/app/api/webhooks/whatsapp/route.ts` — `GET` only. Echoes `hub.challenge`
  verbatim as `text/plain` on success; 403 / 400 / 500 on refusal, with the
  reason in the logs and never in the response body.
- `tests/unit/whatsapp-webhook-verification.test.ts` — 20 tests.

**`/api/webhooks/whatsapp` is now part of the Meta app's configuration.**
Renaming it means reconfiguring the callback URL in the Meta dashboard.

---

## What Task 6.3 built

- `src/server/integrations/meta/inbound-messages.ts` — Meta's payload into
  domain terms. Nothing throws: one unreadable message among a thousand is
  reported as skipped and the rest of the batch proceeds.
- `src/server/services/inbound-message-processing.ts` — stored event → contact →
  conversation → message, idempotent at the message level so an event can be
  replayed after a fix.
- Tests: 16 normalisation unit tests, 8 pipeline integration tests.

### Verified end to end locally, 2026-09-20

Signed POST to the running dev server → event stored → contact and conversation
created → message stored once → **visible at the top of the inbox in the browser
with an unread badge**. Retries and rebatched deliveries produced no duplicates.

What this does _not_ prove: that Meta's real servers can reach us, that the real
App Secret validates, or that a real `wamid` and timestamp look as documented.

---

## Next task

**Task 7.1 — the first real end-to-end demo** (`04_IMPLEMENTATION_ROADMAP.md`).

Everything in code is in place. What remains is configuration:

1. **Rotate the Meta App Secret** — it was exposed in a chat transcript on
   2026-09-20 and must be replaced before the endpoint is publicly reachable.
   Put the new value in `.env.local`; `META_APP_SECRET` currently holds a
   placeholder, so real deliveries would be rejected with 403.
2. **Expose the endpoint over public HTTPS** — a tunnel. Meta rejects
   self-signed certificates and will not deliver to `localhost`.
3. **Configure the webhook in the Meta dashboard** — callback URL
   `<tunnel>/api/webhooks/whatsapp`, the verify token from `.env.local`,
   subscribed to the `messages` field.
4. **Connect the test number to a workspace** — phone number id
   `1275386478999841`, WABA `2439042053289493`. There is still no Embedded
   Signup launcher, so this is a manual insert for now.
5. **Send a WhatsApp message from a real phone** and watch it appear.

Meta account state as of 2026-09-20: app id `1091720370007531`, test number
`+1 (555) 190-2983`, `hello_world` delivered and replied to, so the customer
service window has been opened at least once.
