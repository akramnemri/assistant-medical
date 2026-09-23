-- Conversations and messages.
--
-- This is the schema the first milestone rests on. Two properties matter more
-- than anything else here:
--
-- 1. **Idempotency.** Meta retries webhook deliveries. The provider message id
--    is a unique constraint, so a duplicate delivery fails the insert instead
--    of producing a second copy of a patient's message. Application logic can
--    be wrong; a constraint cannot be talked out of it.
-- 2. **Ownership is not forgeable.** `workspace_id` is denormalised onto
--    conversations and messages so RLS can filter without a join, and composite
--    foreign keys make it impossible for that copy to disagree with the parent.
--
-- Patient content lives in `messages.text_body`. Only normalised fields are
-- stored here — the raw provider payload belongs with the webhook event record
-- (Phase 6), which has its own retention story, rather than duplicated on every
-- message row.

-- ---------------------------------------------------------------------------
-- Composite keys that make denormalised ownership safe
-- ---------------------------------------------------------------------------

-- Redundant given the primary key, but a foreign key can only reference a
-- unique constraint. These let child rows carry workspace_id and have the
-- database guarantee it matches the parent's.
alter table public.whatsapp_connections
  add constraint whatsapp_connections_id_workspace_id_key
  unique (id, workspace_id);

-- ---------------------------------------------------------------------------
-- Contacts (patient identity)
-- ---------------------------------------------------------------------------

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces (id) on delete cascade,

  -- The patient's WhatsApp identity as Meta reports it: an E.164 number
  -- without the leading '+'. Personal data, never logged.
  wa_id text not null check (char_length(wa_id) between 1 and 32),

  -- The name the patient has set on their own WhatsApp profile. Not verified
  -- and not a medical record field.
  profile_name text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The same person messaging two different doctors is two contacts. Identity
  -- is scoped to the workspace so one tenant's patient list can never be
  -- inferred from another's.
  constraint contacts_workspace_id_wa_id_key unique (workspace_id, wa_id)
);

comment on table public.contacts is
  'A patient identity within one workspace. Contains personal data.';

create unique index contacts_id_workspace_id_key
  on public.contacts (id, workspace_id);

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces (id) on delete cascade,

  connection_id uuid not null,
  contact_id uuid not null,

  -- Denormalised from the newest message, maintained by trigger. The
  -- conversation list orders by this; deriving it per row would be a join
  -- against the whole message history on every page load.
  last_message_at timestamptz,

  -- Workspace-level, not per-user: a workspace has one doctor today. When team
  -- members arrive this has to become per-member state, and this column becomes
  -- wrong rather than merely incomplete.
  unread_count integer not null default 0 check (unread_count >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Composite references: a conversation cannot point at another workspace's
  -- connection or contact, whatever the application tries to write.
  constraint conversations_connection_fk
    foreign key (connection_id, workspace_id)
    references public.whatsapp_connections (id, workspace_id) on delete cascade,

  constraint conversations_contact_fk
    foreign key (contact_id, workspace_id)
    references public.contacts (id, workspace_id) on delete cascade,

  -- One thread per patient per connected number. Without this, a webhook race
  -- could create two conversations for the same patient and split their history.
  constraint conversations_connection_id_contact_id_key
    unique (connection_id, contact_id)
);

comment on table public.conversations is
  'One message thread between a workspace''s WhatsApp number and one patient.';

-- The conversation list query: this workspace's threads, most recent first.
create index conversations_workspace_last_message_idx
  on public.conversations (workspace_id, last_message_at desc nulls last);

create index conversations_contact_id_idx on public.conversations (contact_id);

create unique index conversations_id_workspace_id_key
  on public.conversations (id, workspace_id);

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------

create type public.message_direction as enum ('inbound', 'outbound');

-- 'unsupported' is deliberate: Meta can send a type we have not implemented,
-- and one unrecognised payload must not take down the webhook pipeline. Such a
-- message is recorded as unsupported and remains visible rather than lost.
create type public.message_type as enum (
  'text', 'image', 'audio', 'video', 'document',
  'sticker', 'location', 'contacts', 'unsupported'
);

-- Outbound only. Inbound messages have no delivery lifecycle of ours.
create type public.message_delivery_status as enum (
  'pending', 'sent', 'delivered', 'read', 'failed'
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces (id) on delete cascade,
  conversation_id uuid not null,

  direction public.message_direction not null,
  message_type public.message_type not null default 'text',

  -- Meta's `wamid`. Null only for an outbound message we have created but not
  -- yet handed to the provider.
  provider_message_id text
    check (provider_message_id is null
           or char_length(provider_message_id) between 1 and 256),

  -- Patient content. Null for message types that carry no text.
  text_body text,

  delivery_status public.message_delivery_status,
  failure_reason text,

  -- When the provider says the message was sent. Distinct from created_at,
  -- which is when we stored it — those differ by however long delivery and
  -- retries took, and only the provider's timestamp orders a thread correctly.
  sent_at timestamptz not null,
  created_at timestamptz not null default now(),

  constraint messages_conversation_fk
    foreign key (conversation_id, workspace_id)
    references public.conversations (id, workspace_id) on delete cascade,

  -- An inbound message has no delivery status of ours to report.
  constraint messages_inbound_has_no_delivery_status check (
    direction = 'outbound' or delivery_status is null
  ),

  -- An inbound message always comes from the provider, so it always has an id
  -- to deduplicate on. Without this, a webhook bug could insert unattributed
  -- rows that retries would then duplicate freely.
  constraint messages_inbound_has_provider_id check (
    direction = 'outbound' or provider_message_id is not null
  )
);

comment on table public.messages is
  'A single WhatsApp message. text_body contains patient content and is never logged.';

-- THE idempotency boundary.
--
-- Meta retries a webhook until it gets a 200, and the same delivery can arrive
-- more than once. This constraint means a duplicate insert raises 23505, which
-- the webhook treats as "already processed" — rather than relying on the
-- handler checking first, which races against a concurrent retry.
--
-- Partial, because an outbound message has no provider id until it is sent.
create unique index messages_provider_message_id_key
  on public.messages (provider_message_id)
  where provider_message_id is not null;

-- Thread pagination, newest first.
--
-- `id` is part of the key because Meta's timestamps have **one-second
-- resolution**: several messages routinely share a `sent_at`, and a cursor on
-- the timestamp alone would either skip or repeat them at a page boundary.
create index messages_conversation_sent_at_idx
  on public.messages (conversation_id, sent_at desc, id desc);

create index messages_workspace_id_idx on public.messages (workspace_id);

create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function public.set_updated_at();

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Keeping the conversation summary current
-- ---------------------------------------------------------------------------

-- Maintained by trigger rather than by the webhook handler, so the summary
-- cannot drift when a message is inserted by a backfill, a test, or any future
-- writer that forgets.
create or replace function public.refresh_conversation_on_message()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.conversations c
  set
    -- greatest() so an out-of-order delivery — Meta retrying an older event
    -- after a newer one landed — cannot drag the thread backwards in the list.
    last_message_at = greatest(coalesce(c.last_message_at, new.sent_at), new.sent_at),
    unread_count = case
      when new.direction = 'inbound' then c.unread_count + 1
      else c.unread_count
    end
  where c.id = new.conversation_id;

  return new;
end;
$$;

create trigger messages_refresh_conversation
  after insert on public.messages
  for each row execute function public.refresh_conversation_on_message();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.contacts enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy "Members read their workspace's contacts"
  on public.contacts for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Members read their workspace's conversations"
  on public.conversations for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Members read their workspace's messages"
  on public.messages for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

-- No write policies. Inbound messages are written by the webhook, which is
-- authenticated by Meta's signature rather than by a user session and runs with
-- the secret key. Outbound sending (post-MVP) will go through a server action
-- that performs its own authorization before writing.
