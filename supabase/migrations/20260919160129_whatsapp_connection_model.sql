-- WhatsApp connection model.
--
-- A connection is a lifecycle, not "a phone number plus a token". Onboarding
-- can be half-finished, Meta can revoke access without telling us, and a
-- disconnected number can be reconnected later. Modelling that as a nullable
-- token loses the difference between "never started", "in progress",
-- "deliberately disconnected" and "broken", which is exactly the difference
-- support needs to answer "why are my messages not arriving?".
--
-- Provider credentials are deliberately NOT in this table. See
-- whatsapp_connection_secrets below.

-- ---------------------------------------------------------------------------
-- Lifecycle
-- ---------------------------------------------------------------------------

create type public.whatsapp_connection_status as enum (
  'pending',       -- onboarding started, not usable yet
  'connected',     -- usable
  'disconnected',  -- deliberately disconnected, by us or by Meta
  'error'          -- provider or configuration fault; needs attention
);

create table public.whatsapp_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces (id) on delete cascade,

  status public.whatsapp_connection_status not null default 'pending',

  -- Provider identifiers. Stored as provider identifiers, never used as this
  -- application's own primary key: Meta owns their lifecycle, not us.
  -- Null while onboarding is still in progress.
  phone_number_id text
    check (phone_number_id is null or char_length(phone_number_id) between 1 and 64),
  waba_id text
    check (waba_id is null or char_length(waba_id) between 1 and 64),

  -- Display fields returned by Meta. `display_phone_number` is the number a
  -- patient would dial, so it is business contact data rather than a secret,
  -- but it is still personal data and is not logged.
  display_phone_number text,
  verified_name text,

  -- Why the connection is in 'error'. Kept separate from status so the reason
  -- survives a later transition and can be shown after the fact.
  error_code text,
  error_message text,
  error_at timestamptz,

  connected_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A connection cannot be usable without the identifiers needed to send and
  -- receive on it. This is the constraint that stops a half-finished
  -- onboarding being marked 'connected'.
  constraint whatsapp_connections_connected_requires_identity check (
    status <> 'connected'
    or (phone_number_id is not null and waba_id is not null)
  ),

  constraint whatsapp_connections_error_requires_reason check (
    status <> 'error' or error_code is not null
  )
);

comment on table public.whatsapp_connections is
  'A workspace''s link to one WhatsApp Business Platform number. Credentials live in whatsapp_connection_secrets.';

-- Listing a workspace's connections is the hot query.
create index whatsapp_connections_workspace_id_idx
  on public.whatsapp_connections (workspace_id);

-- The inbound webhook arrives knowing only Meta's phone_number_id and has to
-- find the owning workspace from it, on every single event.
create index whatsapp_connections_phone_number_id_idx
  on public.whatsapp_connections (phone_number_id)
  where phone_number_id is not null;

-- A live WhatsApp number belongs to exactly one workspace. Without this, two
-- workspaces could both claim the same number and inbound messages would be
-- routed by whichever row happened to be found first — a cross-tenant leak
-- that no RLS policy would catch, because both rows are legitimately owned.
--
-- Scoped to active statuses on purpose: a number that was disconnected here
-- must be connectable elsewhere later, which a table-wide unique would block
-- forever.
create unique index whatsapp_connections_active_phone_number_id_key
  on public.whatsapp_connections (phone_number_id)
  where phone_number_id is not null and status in ('pending', 'connected');

create trigger whatsapp_connections_set_updated_at
  before update on public.whatsapp_connections
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Credentials
-- ---------------------------------------------------------------------------

-- Separate table with RLS enabled and **no policies at all**.
--
-- That combination makes it unreadable to `anon` and `authenticated` no matter
-- what a future query does, while `service_role` — which bypasses RLS — can
-- still use it from trusted server code. Keeping the token in
-- whatsapp_connections instead would mean one careless `select *` in a server
-- component ships a Meta access token to the browser.
--
-- Privileges are revoked as well as denied by RLS, so that adding a policy by
-- accident later is not sufficient to expose the table.
create table public.whatsapp_connection_secrets (
  connection_id uuid primary key
    references public.whatsapp_connections (id) on delete cascade,

  -- Long-lived system user / business token obtained during onboarding.
  access_token text not null,
  token_expires_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.whatsapp_connection_secrets is
  'Provider credentials. RLS enabled with no policies: reachable only by service_role from server code.';

create trigger whatsapp_connection_secrets_set_updated_at
  before update on public.whatsapp_connection_secrets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Allowed state transitions
-- ---------------------------------------------------------------------------

-- Enforced in the database rather than in application code because the webhook,
-- the onboarding callback and any future admin tooling all write this column.
-- A rule enforced in one of those three places is a rule that holds two thirds
-- of the time.
create or replace function public.enforce_whatsapp_connection_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Unchanged status is always fine: most updates touch other columns.
  if new.status = old.status then
    return new;
  end if;

  if not (
    (old.status = 'pending'      and new.status in ('connected', 'disconnected', 'error'))
    or (old.status = 'connected'    and new.status in ('disconnected', 'error'))
    or (old.status = 'disconnected' and new.status in ('pending', 'connected', 'error'))
    or (old.status = 'error'        and new.status in ('pending', 'connected', 'disconnected'))
  ) then
    raise exception
      'invalid whatsapp connection transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;

  -- Timestamps are set here so every writer records them consistently.
  if new.status = 'connected' then
    new.connected_at := coalesce(new.connected_at, now());
  end if;

  if new.status = 'disconnected' then
    new.disconnected_at := coalesce(new.disconnected_at, now());
  end if;

  if new.status = 'error' then
    new.error_at := coalesce(new.error_at, now());
  end if;

  return new;
end;
$$;

create trigger whatsapp_connections_enforce_transition
  before update of status on public.whatsapp_connections
  for each row execute function public.enforce_whatsapp_connection_transition();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.whatsapp_connections enable row level security;
alter table public.whatsapp_connection_secrets enable row level security;

-- Members may see their workspace's connection state — status, number, and why
-- it broke. That is what the connection screen renders.
create policy "Members read their workspace's WhatsApp connections"
  on public.whatsapp_connections for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

-- No insert, update or delete policy. Connections are created and transitioned
-- by the server-side onboarding callback and the webhook, both of which handle
-- provider credentials and run with the secret key. Giving the browser a write
-- path would mean trusting a client-supplied provider id.

-- Deliberately no policy of any kind on the secrets table.
revoke all on public.whatsapp_connection_secrets from anon, authenticated;
