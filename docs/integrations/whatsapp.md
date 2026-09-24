# WhatsApp Business Platform — verified requirements

**Verified against Meta's official documentation on 2026-09-20.**

Meta changes this platform frequently: version numbers, deprecation dates and
onboarding paths all move. Re-verify before building against anything here, and
treat a tutorial or a remembered API version as out of date by default. Every
claim below links to the page it came from.

Nothing in this document has been exercised against a real Meta app — this
project has no Meta developer account yet (see [Blockers](#blockers)).

---

## Current API version

|                          |                                           |
| ------------------------ | ----------------------------------------- |
| Latest Graph API version | **v26.0**, released 29 July 2026          |
| Previous                 | v25.0 (18 Feb 2026), expires 29 July 2028 |

Versions are supported for roughly two years after release. Pin a version
explicitly in every request path rather than relying on a default, so an
upstream default change cannot silently alter behaviour.

Source: [Graph API changelog](https://developers.facebook.com/docs/graph-api/changelog)

---

## Onboarding: Embedded Signup

Businesses connect their WhatsApp account through Meta's hosted **Embedded
Signup** flow. The customer authenticates with Meta, accepts terms, selects or
creates a business portfolio and WhatsApp Business Account (WABA), enters and
verifies a business phone number, and sets a display name.

On completion the flow returns:

- the customer's **WABA ID**
- the customer's **business phone number ID**
- an **exchangeable token code**

The code is exchanged **server-to-server** for a customer-scoped business token.
That exchange must never happen in the browser — it is the whole reason
`whatsapp_connection_secrets` exists as a server-only table (see
[architecture.md](../architecture.md)).

### Version deadline

> Embedded Signup **v2 is deprecated**. Build on **v4**.

⚠️ **Two Meta sources disagree on the exact date**: the Embedded Signup overview
and the coexistence page both say **15 October 2026**, while a search result
snippet said 8 October 2026. Either way it is weeks away from this writing, so
**v4 is the only sensible target** — but confirm the date before relying on it.

### Development mode — verified 2026-09-24

> While your app is in development mode, these permissions will appear in
> Embedded Signup's authorization screen to anyone who has an **admin,
> developer, or tester role** on your app.

This is the fact that decides whether building the launcher is worthwhile
before App Review: **the app owner can run the real flow today.** App Review
and Advanced Access are required only to onboard _other_ businesses.

### Browser implementation — verified 2026-09-24

Facebook Login for Business plus Meta's JavaScript SDK
(`https://connect.facebook.net/en_US/sdk.js`). `FB.login` is called with a
**configuration id** created in the app dashboard, `response_type: "code"` and
`override_default_response_type: true`. Without that last flag the SDK returns
an **access token to the browser** instead of a code, which is precisely what
the server-side exchange exists to prevent.

The selected number arrives separately, as a `postMessage` of type
`WA_EMBEDDED_SIGNUP` carrying `phone_number_id` and `waba_id`. It and the login
callback race, so neither may be assumed to arrive first.

⚠️ Meta's own sample validates the sender with
`event.origin.endsWith("facebook.com")`, which accepts
`https://evil-facebook.com`. Our implementation matches the origin exactly.

Source: [Embedded Signup implementation](https://developers.facebook.com/docs/whatsapp/embedded-signup/implementation)

### Permissions

| Scope                          | Needed for                                                               |
| ------------------------------ | ------------------------------------------------------------------------ |
| `whatsapp_business_management` | Access to onboarded customers' WABA settings and message templates       |
| `whatsapp_business_messaging`  | Access to business phone number settings; sending and receiving messages |

This product needs **both**.

### Onboarding volume limits

Completing Business Verification, App Review and Access Verification raises the
limit to **200 new business customers per rolling 7-day window**. Below that
tier the cap is lower — a constraint on how fast doctors can be onboarded, not
on how many messages they can send.

Sources: [Embedded Signup](https://developers.facebook.com/docs/whatsapp/embedded-signup),
[Onboard WhatsApp Business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)

---

## The product question: what can a doctor actually connect?

This is the section the architecture and roadmap prompts specifically warn
about, so it is stated precisely.

### There are three different product states

| The doctor currently uses                  | Can we connect it?                          |
| ------------------------------------------ | ------------------------------------------- |
| **Personal WhatsApp** (WhatsApp Messenger) | **No.** Not supported by any official flow. |
| **WhatsApp Business app**                  | **Yes**, via Coexistence — with conditions  |
| **A number not on WhatsApp at all**        | **Yes**, standard Embedded Signup           |

### Personal WhatsApp is not supported

Meta's coexistence documentation is explicit that the feature serves the
WhatsApp Business app, **not personal WhatsApp Messenger accounts**.

**Therefore the UI must never offer to "merge", "convert" or "upgrade" a
personal WhatsApp account.** There is no such action. A doctor using personal
WhatsApp must either move to the WhatsApp Business app first, or use a
different number. Saying anything else would be inventing a flow that does not
exist and would strand the user partway through onboarding.

### Coexistence, for WhatsApp Business app users

A number already in use with the **WhatsApp Business app** can be onboarded to
the Cloud API and used from both at once. Meta's wording: the business can still
send one-to-one messages from the Business app, and _"WhatsApp keeps messaging
history between both apps in sync"_.

What it provides:

- up to **180 days** of chat history synchronised, **with the business's
  consent**
- contacts with WhatsApp numbers synchronised
- messages sent from the Business app mirrored into our platform

**Requirements — note these are on us, not only the doctor:**

- the provider must be a **Solution Partner or Tech Provider**
- **Embedded Signup v4 with session logging**
- the doctor's **WhatsApp Business app must be v2.24.17 or higher**
- our webhook must be accepting events successfully

**Limitations to surface in the UI before a doctor commits:**

- throughput is capped at **20 messages per second** for coexisting numbers
- **group chats, disappearing messages and broadcast lists are disabled** after
  onboarding — a real behaviour change to the doctor's existing app
- the data sync window is **24 hours** after onboarding

### Registering a number removes it from WhatsApp Messenger

The single most important sentence for onboarding UX, from
[Business phone numbers](https://developers.facebook.com/docs/whatsapp/phone-numbers)
(verified 2026-09-20):

> Registered numbers can still be used for ordinary purposes such as calls and
> SMS, but **cannot be used on WhatsApp Messenger**. Numbers already in use with
> WhatsApp cannot be registered unless they are deleted first.

So "connect the number I already use on WhatsApp" is never a free action. It is
always either coexistence (Business app only, needs Tech Provider status) or
deleting the WhatsApp account on that number. The number keeps working as a
phone; it stops working as a WhatsApp Messenger account.

A number must also be one you own, have a country code, and be able to receive
a voice call or SMS for the one-time verification code.

### The destructive alternative

A Business app number can instead be **deleted and re-registered** on the Cloud
API. This **loses existing message history**, and the number cannot be used in
the WhatsApp Business app again unless deregistered from the Cloud API.
Deregistration takes up to ~3 minutes to release the number.

This path should be offered only with an unambiguous warning, if at all.

Sources: [Onboard WhatsApp Business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users),
[Migrate an existing WhatsApp number](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started/migrate-existing-whatsapp-number-to-a-business-account/)

---

## Webhooks

### Verification (GET)

Meta sends a GET with:

| Parameter          | Meaning                                               |
| ------------------ | ----------------------------------------------------- |
| `hub.mode`         | always `subscribe`                                    |
| `hub.verify_token` | must equal our configured `META_WEBHOOK_VERIFY_TOKEN` |
| `hub.challenge`    | echo this back verbatim                               |

Validate the token **before** echoing the challenge. Echoing unconditionally
would let anyone attach a webhook.

Implemented in `src/server/integrations/meta/webhook-verification.ts`, exposed
at **`/api/webhooks/whatsapp`** — this is the callback URL to enter in the Meta
app dashboard, so renaming the route means reconfiguring the Meta app. The
comparison is timing-safe, and the endpoint fails closed when
`META_WEBHOOK_VERIFY_TOKEN` is unset rather than accepting the handshake.

### Transport

> "Your server must have a valid TLS or SSL certificate correctly configured and
> installed. Self-signed certificates are not supported."

This rules out plain `localhost` for real deliveries and means a tunnel or a
deployed preview URL is required to test Phase 6.

### Authenticity (POST)

- header: **`X-Hub-Signature-256`**
- format: `sha256={signature}`
- algorithm: **SHA256 HMAC of the raw payload, keyed with the app secret**

The signature is computed over the **raw request body**. The body must be read
as raw bytes before any JSON parsing, because re-serialising changes the bytes
and breaks the comparison. Compare using a **timing-safe** equality function.

### Delivery semantics — the part the schema already accounts for

> Event notifications are aggregated and sent in a batch **with a maximum of
> 1000 updates**.

> Failed deliveries are retried "immediately, then ... a few more times with
> decreasing frequency over the next **36 hours**".

> **"Your server should handle deduplication."**

Meta states plainly that deduplication is the receiver's responsibility. This
confirms the Task 3.2 design: the unique index on
`messages.provider_message_id` is the idempotency boundary, and a duplicate
delivery raises `23505` rather than creating a second copy of a patient's
message. A handler that checked for existence before inserting would race
against its own retry.

Respond **`200 OK`** to every notification, including ones we cannot parse — a
non-200 causes 36 hours of retries for a payload that will never succeed.
Unparseable events should be recorded and acknowledged, not rejected.

Historical webhook data **cannot be queried later**, so an event dropped on the
floor is gone permanently. Persist first, process after.

Source: [Webhooks — Getting Started](https://developers.facebook.com/docs/graph-api/webhooks/getting-started)

---

## Cost

Verified 2026-09-20 against
[WhatsApp pricing](https://developers.facebook.com/docs/whatsapp/pricing).

**For this product's core use case, messaging is free.**

A patient messaging the doctor opens a **customer service window**. Meta's
wording: _"All non-template messages are free"_ when sent within one, and
_"All messages are free for 72 hours, including template messages, if sent
within an open free entry point window."_

That is exactly the shape of this product: the patient writes first, the doctor
replies. The entire first milestone — inbound message, stored, shown, replied
to — sits inside the free path.

|                                                           | Charged?           |
| --------------------------------------------------------- | ------------------ |
| Patient-initiated messages                                | **Free**           |
| Doctor's replies, non-template, inside the service window | **Free**           |
| Utility templates inside the service window               | **Free**           |
| Utility / authentication templates **outside** the window | Charged            |
| Marketing templates                                       | **Always charged** |

Since **1 July 2025**: _"You are only charged when a template message is
delivered."_ Pricing is strictly per message — there is **no monthly free
allowance**, and equally no subscription or minimum.

What this means in practice: the cost only begins when the product starts
messaging patients _first_ — appointment reminders, follow-ups, campaigns. That
is a post-MVP decision, and a per-message one that can be modelled when it
arrives.

The pricing page covers per-message charges only and lists no platform or
hosting fee for the Cloud API itself. Meta hosts it, so there is no server cost
on our side for the messaging layer either.

**Verified 2026-09-20** against
[Business phone numbers](https://developers.facebook.com/docs/whatsapp/phone-numbers):
completing the get-started flow yields a registered **test business phone
number** automatically. It costs nothing, and it is the right number to develop
against — see the registration rule below before considering a real one.

---

## Blockers

Per the roadmap, implementation **stops here** until the following exist. None
of them are code.

1. **A Meta developer account and app** with WhatsApp added. Nothing in Phase 5
   or 6 can be built or tested without one.
2. **A Meta Business portfolio**, and Business Verification for anything beyond
   the lowest onboarding tier.
3. **A publicly reachable HTTPS endpoint** for webhooks — a tunnel for local
   development, or a deployed preview. Self-signed certificates are rejected.
4. **A test phone number**, which the Cloud API provides free for development.
5. **Solution Partner or Tech Provider status**, _only if_ coexistence is
   required for the first customers. Standard Embedded Signup does not need it,
   so this can be deferred — but it determines whether a doctor already using
   the WhatsApp Business app can keep their history.

### Consequences for product scope

Coexistence is the difference between "keep your number and your history" and
"start again on a new number". For doctors who already run their practice from
the WhatsApp Business app, that is likely to decide whether they adopt the
product at all. It is worth an explicit decision early, because Solution
Partner status is not something that can be arranged in an afternoon.

---

## Deliberately not covered

Only what Task 5.1 requires was verified. Not yet checked, and to be verified at
the point of use rather than assumed: message template submission and approval,
pricing and conversation categories, rate limits beyond the coexistence cap,
media upload and retention, the 24-hour customer service window, and
flows/interactive message types.
