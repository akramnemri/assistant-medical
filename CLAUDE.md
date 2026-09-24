@AGENTS.md

# Project summary

A SaaS platform that centralises patient conversations a doctor receives through
WhatsApp. Next.js 16 + TypeScript on Vercel, Supabase for auth/Postgres/RLS/
Realtime, Meta WhatsApp Business Platform (Cloud API) for messaging.

**This file is loaded into every session, so it stays short.** The living,
detailed handoff is `docs/project-state.md` — read that before starting work.
Where the two disagree, the repository wins over both.

---

## What exists, 2026-09-24

The **first milestone is complete and was proven with a real WhatsApp message
from a real phone**, not a fixture:

```
phone -> WhatsApp -> Meta Cloud API -> HTTPS -> POST /api/webhooks/whatsapp
     -> signature verified -> raw event stored -> contact + conversation
     -> message stored once -> visible in the browser without a refresh
```

Built in order, one bounded task at a time, each stopping for a manual test:

| Phase | What landed                                                                                  |
| ----- | -------------------------------------------------------------------------------------------- |
| 0–1   | Tooling, route skeleton, typed errors with stable codes, structured logging, correlation IDs |
| 2     | Supabase clients, email/password auth, workspace/membership model with RLS                   |
| 3     | WhatsApp connection model, conversations/messages schema, read services                      |
| 4     | Conversation list, thread with pagination, Realtime delivery                                 |
| 5     | Verified Meta's real requirements, connection UI, server-side onboarding exchange            |
| 6     | Webhook verification, secure receiver, inbound normalisation                                 |
| 7     | End-to-end demo, hardening, promoted `develop` → `main`                                      |

Eight migrations. 296 unit/integration tests, 97 pgTAP assertions, 40 Playwright
tests. Deployed to Vercel against a hosted Supabase project.

---

## Decisions worth not relitigating

- **Personal WhatsApp cannot be connected.** Registering a number for the Cloud
  API removes it from WhatsApp Messenger permanently. The UI says so plainly and
  must never offer to "merge" or "upgrade" a personal account — no such action
  exists. Coexistence covers only the WhatsApp Business app and needs Tech
  Provider status we do not have.
- **Messaging is free for this product's shape.** A patient writes first, which
  opens a 24-hour service window where replies cost nothing.
- **Idempotency lives in the database, not the handler.** A digest of the raw
  delivery body catches byte-identical retries; the unique index on
  `messages.provider_message_id` catches a rebatched duplicate that hashes
  differently. Two layers, because each misses what the other catches. A
  check-then-insert would race its own retry.
- **Persist the raw payload first, interpret afterwards.** Meta cannot be asked
  for an event twice, so a normalisation bug must be replayable rather than
  fatal.
- **Webhook status codes are asymmetric on purpose.** An unreadable payload gets
  200 (retrying will not help, and a non-200 buys 36 hours of redelivery); a
  failed database write gets 500 (the retry is the only chance to keep it).
- **Platform admin is its own table, not a column on `profiles`.** Profiles are
  self-updatable, so a flag there would have let any doctor promote themselves.
- **RLS does not cover TRUNCATE.** Browser roles had it by default and could
  have erased every workspace's messages. Revoked, and swept by a pgTAP test so
  a new table cannot reintroduce it.

---

## What does not exist yet

Stated plainly because "milestone complete" reads like a finished product:

- **No way to reply.** A doctor reads patient messages and cannot answer.
- **No Embedded Signup.** Connecting a number is an `insert` run by hand. The
  button on the WhatsApp page is deliberately dead. Onboarding _other_
  businesses also needs Meta App Review and Tech Provider status.
- **Media is unreadable.** Type and caption are stored; there are no URL or MIME
  columns.
- **Staging only.** Vercel Hobby is non-commercial personal use. Real patients
  mean paid plans _and_ a legal assessment — the applicable regime is Tunisian
  data protection law, possibly GDPR, and no hosting plan substitutes for it.

---

## Working agreement

One bounded task per response: implement, run the automated gate, report, then
**stop for the developer's manual test**. Branch `feat/…` off `develop`, merge
after the test passes, delete the branch. `main` is promoted only at a milestone.

Never claim a check that was not run. Distinguish _implemented_ / _automatically
tested_ / _manually verified_ / _not yet verified_, and when unsure the answer
is "not yet verified".

Secrets go from their source into `.env.local` or the host's environment
directly — never through chat, never into a file by an agent's hand.
