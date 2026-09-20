-- Durable record of every inbound WhatsApp webhook delivery.
--
-- Meta states plainly that historical webhook data cannot be queried later: an
-- event we drop is gone permanently, and a patient's message with it. So the
-- receiver's first job is to write the raw payload down, and only then to
-- interpret it. Persist first, process after.
--
-- This table is therefore the recovery story. If normalisation has a bug, the
-- events are still here and can be replayed; if we had normalised first and
-- thrown the payload away, the bug would have eaten real messages.
--
-- It holds raw provider payloads, which contain **patient message content**.
-- Treated accordingly: RLS on with no policies, privileges revoked, never
-- logged, and it will need a retention policy before production.

create type public.webhook_event_status as enum (
  'received',   -- stored, not yet interpreted
  'processed',  -- turned into messages successfully
  'failed',     -- interpretation failed; payload retained for replay
  'ignored'     -- understood and deliberately not acted on
);

create table public.whatsapp_webhook_events (
  id uuid primary key default gen_random_uuid(),

  -- THE delivery-level idempotency boundary.
  --
  -- Meta sends no delivery id, but a retry repeats the same bytes, so a digest
  -- of the raw body identifies a repeat. A conflict here means "already have
  -- this delivery" and the receiver acknowledges without doing the work twice.
  --
  -- This is deliberately not the only defence: a genuinely new batch that
  -- re-includes an old message hashes differently, and the unique index on
  -- messages.provider_message_id catches it at the message level instead. Two
  -- layers, because each one misses a case the other does not.
  payload_hash text not null unique check (char_length(payload_hash) = 64),

  -- Null when the delivery names a phone number we do not recognise. The event
  -- is still stored: an unroutable event is evidence of a misconfiguration,
  -- and discarding it would destroy the only trace of it.
  connection_id uuid,
  workspace_id uuid,

  -- Meta's identifier for the number the message was sent to. Kept even when
  -- the lookup fails, because it is what someone will need to work out which
  -- account is misconfigured.
  phone_number_id text,

  status public.webhook_event_status not null default 'received',

  -- The payload exactly as Meta sent it, parsed. Opaque and provider-shaped by
  -- intention: this is the one place a raw provider structure belongs.
  payload jsonb not null,

  -- Why interpretation failed. A safe code, not a stack trace.
  error_code text,
  error_message text,

  received_at timestamptz not null default now(),
  processed_at timestamptz,

  -- A workspace-owned event must agree with its connection's workspace.
  constraint whatsapp_webhook_events_connection_fk
    foreign key (connection_id, workspace_id)
    references public.whatsapp_connections (id, workspace_id) on delete set null,

  -- Either both ownership columns are set or neither is. A half-routed event
  -- would be silently invisible to anything filtering by workspace.
  constraint whatsapp_webhook_events_ownership_complete check (
    (connection_id is null) = (workspace_id is null)
  ),

  constraint whatsapp_webhook_events_failed_requires_reason check (
    status <> 'failed' or error_code is not null
  )
);

comment on table public.whatsapp_webhook_events is
  'Raw inbound Meta webhook deliveries. Contains patient content. RLS enabled with no policies: reachable only by service_role from server code.';

-- The replay/backlog query: what has arrived but not yet been turned into
-- messages, oldest first.
create index whatsapp_webhook_events_unprocessed_idx
  on public.whatsapp_webhook_events (received_at)
  where status in ('received', 'failed');

-- "Show me this workspace's recent deliveries" — the support question.
create index whatsapp_webhook_events_workspace_received_idx
  on public.whatsapp_webhook_events (workspace_id, received_at desc)
  where workspace_id is not null;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

-- No policies, deliberately. There is no user-facing reason to read raw
-- payloads, and they contain patient content — so the webhook's service_role
-- client is the only thing that can reach this table at all.
alter table public.whatsapp_webhook_events enable row level security;

revoke all on public.whatsapp_webhook_events from anon, authenticated;
