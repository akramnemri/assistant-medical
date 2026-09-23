# Deployment

**Status: staging only.** Vercel's Hobby plan is restricted to non-commercial
personal use, so what is described here is a synthetic-data staging environment,
not somewhere real patients may be served. Going commercial means Vercel Pro
(~$20/mo) and Supabase Pro (~$25/mo); anything touching real patient records
also needs a legal assessment that no hosting plan substitutes for. See
`docs/project-state.md`.

Verified against both providers' pricing pages on 2026-09-23.

---

## What has to exist

|                   |                                                            |
| ----------------- | ---------------------------------------------------------- |
| GitHub repository | `akramnemri/assistant-medical`, already pushed             |
| Supabase project  | hosted, free tier — the app cannot start without one       |
| Vercel project    | imported from the repository                               |
| Meta app          | exists; its callback URL must be repointed after deploying |

Vercel alone is not enough. The database is a separate service and comes first.

---

## 1. Create the Supabase project

`supabase.com` → **New project**, free plan.

- Pick a region near your users. From Tunisia, `eu-west-3` (Paris) or
  `eu-central-1` (Frankfurt) are the closest.
- **Save the database password.** It is shown once, and pushing migrations
  needs it.

Then **Settings → API**, and copy three values:

| Value           | Goes into                              |
| --------------- | -------------------------------------- |
| Project URL     | `NEXT_PUBLIC_SUPABASE_URL`             |
| Publishable key | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| Secret key      | `SUPABASE_SECRET_KEY`                  |

The publishable key is safe in the browser **only because RLS is enforced**.
The secret key bypasses RLS entirely and must never reach a `NEXT_PUBLIC_*`
variable.

### Turn off email confirmation

**Authentication → Sign In / Providers → Email → uncheck "Confirm email".**

This is the step that otherwise makes the deployment look broken. Locally
`supabase/config.toml` sets `enable_confirmations = false`, but a hosted project
defaults it **on** — and the free tier's built-in email service only delivers to
project members, at a handful of messages per hour. Sign-up appears to succeed
and no account is ever usable.

Acceptable for staging with synthetic accounts. **Not acceptable for real
users**: before anyone real signs up, configure a proper SMTP provider and turn
confirmation back on.

---

## 2. Push the schema

The hosted project starts empty. From the repository root:

```bash
npx supabase link --project-ref <your-project-ref>
```

```bash
npx supabase db push
```

Both prompt for the database password. **Run these yourself** — the password is
a credential and does not belong in a script or a chat transcript.

`db push` applies `supabase/migrations/` in order. It does **not** run
`supabase/seed.sql`, which is correct: the seeded doctors are development
fixtures and must not exist on a deployed environment. Create an account through
the sign-up page instead; the sign-up trigger provisions a workspace.

---

## 3. Create the Vercel project

`vercel.com` → **Add New → Project** → import `akramnemri/assistant-medical`.

Next.js is detected automatically; no `vercel.json` is needed. Vercel builds the
repository's default branch, `main`.

Set these environment variables before the first deploy:

| Variable                               | Value                                     |
| -------------------------------------- | ----------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | the project URL from step 1               |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the publishable key                       |
| `NEXT_PUBLIC_SITE_URL`                 | `https://<your-project>.vercel.app`       |
| `SUPABASE_SECRET_KEY`                  | the secret key                            |
| `META_APP_ID`                          | `1091720370007531`                        |
| `META_APP_SECRET`                      | the rotated app secret                    |
| `META_WEBHOOK_VERIFY_TOKEN`            | any string you choose; it must match Meta |

The first three are **required** — the app fails to start without them, by
design, so a missing variable is a loud startup error rather than a confusing
runtime one. The Meta variables are optional; without them the WhatsApp screen
reports "not configured" and the webhook fails closed.

`NEXT_PUBLIC_SITE_URL` is only known after the first deploy, so either set a
placeholder and correct it, or deploy once and redeploy.

---

## 4. Repoint Meta at the deployment

The callback URL currently points at a Cloudflare quick tunnel, which dies with
the session that started it. Replace it with the Vercel domain — this is the
main reason to deploy at all.

```
https://<your-project>.vercel.app/api/webhooks/whatsapp
```

The dashboard UI for this is hard to find; the Graph API is reliable:

```
POST https://graph.facebook.com/v26.0/{app-id}/subscriptions
  object=whatsapp_business_account
  callback_url=<the URL above>
  verify_token=<META_WEBHOOK_VERIFY_TOKEN>
  fields=messages
  access_token={app-id}|{app-secret}
```

Meta calls the `GET` handshake during that request, so a `{"success":true}`
means verification really happened against the deployed endpoint.

The WhatsApp Business Account is already subscribed to the app and that does not
need repeating.

---

## 5. Connect a number

There is still no Embedded Signup launcher, so a connection is an insert run
with the secret key against the hosted database:

```sql
insert into public.whatsapp_connections
  (workspace_id, status, phone_number_id, waba_id, display_phone_number, verified_name)
values
  ('<your workspace id>', 'connected', '1275386478999841', '2439042053289493',
   '+1 555 190 2983', 'Test Number');
```

Find the workspace id in `workspace_members` after signing up.

---

## What deploying does not solve

- **The test suites still run against the local stack.** `npm run db:test` and
  the integration tests point at the local Supabase, not at the deployment.
- **No staging/production separation.** One deployment, one database. A second
  Supabase project would be needed for that, and the free plan allows two.
- **Free projects pause after a week of inactivity** and wake on the next
  request — which means the first webhook after a quiet week may be slow enough
  for Meta to retry. Harmless, thanks to the idempotency digest.
- **The verify token will appear in Vercel's access logs**, because Meta sends
  it in the query string. Keep it distinct from the app secret.
