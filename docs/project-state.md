# Project state

Handoff note for the next session. **Verify these claims against the repository
before relying on them** — see `docs/prompts/05_SESSION_CONTINUITY.md`.

**Last updated:** 2026-09-23. **First milestone complete, every criterion verified.**

---

## Where development stopped

|                |                                                                               |
| -------------- | ----------------------------------------------------------------------------- |
| **Milestone**  | First milestone: a trustworthy inbound WhatsApp message pipeline              |
| **Phase**      | 6 complete. **The inbound pipeline works end to end with real Meta traffic.** |
| **Last task**  | **Task 6.3 — normalise inbound messages into conversations**                  |
| **Task state** | **Merged. Verified with a real WhatsApp message from a real phone.**          |
| **Branch**     | `develop`, clean tree                                                         |
| **Next task**  | **Task 7.2 — milestone hardening**, then consider `develop` → `main`          |

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

| Area                               | State                                                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Auth, workspaces, RLS              | implemented · auto-tested · **manually verified**                                                                    |
| Conversation list and thread       | implemented · auto-tested · **manually verified**                                                                    |
| Realtime message delivery          | implemented · auto-tested · **manually verified** (browser: 60→61 messages, no reload)                               |
| WhatsApp connection model + UI     | implemented · auto-tested · **not manually verified**                                                                |
| **Meta onboarding exchange (5.3)** | implemented · auto-tested against a **mocked** provider · **NOT VERIFIED — never called with real Meta credentials** |
| **Webhook verification (6.1)**     | implemented · auto-tested · **verified against a real Meta handshake** on 2026-09-20 19:22 UTC                       |
| **Webhook receiver (6.2)**         | implemented · auto-tested · **verified with a real signed Meta delivery**                                            |
| **Inbound normalisation (6.3)**    | implemented · auto-tested · **verified end to end from a real phone**                                                |
| Outbound messaging                 | **not implemented**                                                                                                  |
| Deployment                         | **not implemented** — never deployed anywhere                                                                        |

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

- Fixed 2026-09-23: every table carried Supabase's default grant of ALL to
  `anon` and `authenticated`, which includes **TRUNCATE — a privilege Row Level
  Security does not filter**. The `authenticated` role could empty
  `public.messages` across every workspace, and no policy would have been
  consulted. Not reachable through PostgREST, so latent rather than live, but
  fixed and covered by `supabase/tests/table_privileges_test.sql`. **Any new
  table must not re-grant it** — the migration also changes default privileges,
  and the pgTAP sweep fails if one slips through.

- `/admin` is now closed by default: it requires a row in `platform_admins`,
  a privilege deliberately kept separate from workspace roles and grantable
  only with the service key. No platform admin is seeded, so the route 404s
  for every account including both seeded doctors. To grant one locally, see
  the comment at the foot of the `platform_admins` migration.

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
- **Local experiments still affect the suites, but they now say so.** The pgTAP
  suite no longer aborts when a workspace has a second connection — it looks
  fixtures up by the seed's stable identifiers and asserts they exist. The two
  Playwright specs that genuinely depend on fixture state (the connection screen
  and admin access) cannot be made data-independent without weakening what they
  assert, so instead their failures name the cause and tell you to run
  `npm run db:reset`. Both known triggers are ordinary workflow: connecting a
  real number, and granting yourself platform admin to look at `/admin`.
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

## The first milestone was reached on 2026-09-20

A real WhatsApp message, from a real phone, appeared in the application.

```
phone (+216…272)
  -> WhatsApp
  -> Meta Cloud API
  -> Cloudflare quick tunnel (HTTPS)
  -> POST /api/webhooks/whatsapp
  -> X-Hub-Signature-256 verified with the real app secret
  -> raw event stored (whatsapp_webhook_events)
  -> contact + conversation created
  -> message stored once
  -> visible in the inbox
```

Evidence, not inference:

- `19:22:41` — `whatsapp webhook subscription verified`, Meta's own GET handshake
- `19:27:47` — delivery stored, `routed: true`, then `processed`, `inserted: 1`
- a genuine `wamid.HBgLMjE2MjMzMjMyNzIVAg…`, not a fixture
- the inbox showed the sender's WhatsApp profile name with one unread

**This retires the project's biggest risk.** Everything in `integrations/meta`
had been written from documentation alone, against an API never once called. The
payload shape, the signature scheme, the string-seconds timestamp and the wamid
all behaved as `docs/integrations/whatsapp.md` said they would.

### Realtime, verified 2026-09-23

Re-run from a clean `db:reset`: four real messages delivered and processed, then
the **thread** left open while a message was sent from the phone — **it appeared
with no refresh**. That was the last open milestone criterion.

One trap worth remembering, because it cost a round: **the conversation list is
not realtime, only the thread is.** Watching the list and seeing nothing is
correct behaviour, not a failure. Test realtime on `/conversations/<id>`, and
wait a few seconds after load before sending — the subscription takes a moment
to go live and a message arriving in that window is still missed.

### What is still NOT proven

- Media messages, ordering across a large batch, or Meta's retry behaviour under
  a real failure.
- Anything deployed. This has only ever run on one laptop behind a tunnel.

---

## Immediate state, 2026-09-23

- **A tunnel is running** at
  `https://description-legislative-invoice-medal.trycloudflare.com`, registered
  with Meta and working. It dies with this session; a quick tunnel gets a new
  URL every time, so re-registration is part of every re-run.
- **There is a hand-inserted connection row** for phone number id
  `1275386478999841` in Doctor A's workspace. It breaks the pgTAP suite and one
  Playwright spec, which assume one connection per seeded workspace.
  `npm run db:reset` removes it — **do that before running the suites**.

### Re-running the live demo

1. Start Docker Desktop, then `npx supabase start`, then `npm run dev`.
2. `cloudflared tunnel --url http://localhost:3000` — note the new URL.
3. Re-register it: `POST /v26.0/{app-id}/subscriptions` with
   `object=whatsapp_business_account`, the new `callback_url`, the verify token,
   `fields=messages`, and an app access token (`{app-id}|{app-secret}`).
   The dashboard UI for this is hard to find; the API call is reliable.
4. The WABA is already subscribed to the app, so this step does not repeat.
5. Insert a `connected` connection for phone number id `1275386478999841`,
   WABA `2439042053289493`, because there is still no Embedded Signup launcher.

Meta account: app id `1091720370007531`, test number `+1 (555) 190-2983`.
`META_APP_SECRET` in `.env.local` is the real, rotated secret.

---

## Next task

**Task 7.2 — first milestone hardening** (`04_IMPLEMENTATION_ROADMAP.md`).

Task 7.1 is effectively done — the end-to-end demo happened. What 7.2 asks for,
in the order that matters here:

1. **Watch realtime live.** Inbox open, send from a phone, confirm no refresh.
   This is the one milestone criterion still unverified.
2. **Fix the fixture fragility.** The pgTAP suite and one E2E spec assume each
   seeded workspace has exactly one connection; a real connection breaks them
   with errors that point elsewhere. This cost time twice.
3. **Decide on `/admin`**, which any signed-in user can still reach. It is the
   largest open authorization gap and should not be promoted to `main` as is.
4. Re-check RLS, indexes and idempotency; confirm no secret is committed.
5. Full `verify`, `db:test`, `test:e2e` with the stack up and **no skipped
   suites**.

Only then consider `develop` → `main`.
