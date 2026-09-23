-- WhatsApp connection model: lifecycle, uniqueness and access tests.
--
-- The seed has already created doctor A (connected) and doctor B (pending), so
-- these tests reuse that data rather than rebuilding it, and use distinct ids
-- of their own wherever they insert.
--
-- The seeded rows are looked up by the stable identifiers the seed assigns,
-- never by "the connection belonging to this workspace". Developing against
-- this project means connecting real numbers locally, and a workspace with a
-- second connection used to make `\gset` abort with "more than one row
-- returned" — which reads as a broken test file rather than as leftover data.
--
-- Run with: npm run db:test

begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

\set doctor_a_id '11111111-1111-1111-1111-111111111111'
\set doctor_b_id '22222222-2222-2222-2222-222222222222'

select workspace_id as a_workspace_id
from public.workspace_members
where user_id = :'doctor_a_id' \gset

select workspace_id as b_workspace_id
from public.workspace_members
where user_id = :'doctor_b_id' \gset

select id as a_connection_id
from public.whatsapp_connections
where phone_number_id = 'SYNTHETIC_PHONE_ID_A' \gset

select id as b_connection_id
from public.whatsapp_connections
where waba_id = 'SYNTHETIC_WABA_B' \gset

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
--
-- Checked explicitly so that a seed which has drifted fails here, naming the
-- fixture, instead of surfacing as a puzzling assertion failure further down.

select is(
  (select count(*) from public.whatsapp_connections
   where phone_number_id = 'SYNTHETIC_PHONE_ID_A'),
  1::bigint,
  'the seeded connected fixture exists exactly once (run npm run db:reset)'
);

select is(
  (select count(*) from public.whatsapp_connections
   where waba_id = 'SYNTHETIC_WABA_B'),
  1::bigint,
  'the seeded pending fixture exists exactly once (run npm run db:reset)'
);

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class
   where oid = 'public.whatsapp_connections'::regclass),
  'RLS is enabled on whatsapp_connections'
);

select ok(
  (select relrowsecurity from pg_class
   where oid = 'public.whatsapp_connection_secrets'::regclass),
  'RLS is enabled on whatsapp_connection_secrets'
);

-- The secrets table is protected by having no policies at all. If one is ever
-- added, this test fails and forces the decision to be made deliberately.
select is(
  (select count(*) from pg_policies
   where schemaname = 'public' and tablename = 'whatsapp_connection_secrets'),
  0::bigint,
  'whatsapp_connection_secrets has no RLS policies, so only service_role reaches it'
);

select ok(
  not has_table_privilege('authenticated', 'public.whatsapp_connection_secrets', 'SELECT'),
  'the authenticated role has no SELECT privilege on the secrets table'
);

select ok(
  not has_table_privilege('anon', 'public.whatsapp_connection_secrets', 'SELECT'),
  'the anon role has no SELECT privilege on the secrets table'
);

-- A token stored on the connection row itself would be readable by any member,
-- since members can select their own connections.
select hasnt_column(
  'public', 'whatsapp_connections', 'access_token',
  'the connection row does not carry the access token'
);

-- ---------------------------------------------------------------------------
-- Constraints that keep a half-finished connection out of service
-- ---------------------------------------------------------------------------

select throws_ok(
  format(
    $$insert into public.whatsapp_connections (workspace_id, status)
      values (%L::uuid, 'connected')$$,
    :'a_workspace_id'
  ),
  '23514',
  null,
  'a connection cannot be marked connected without provider identifiers'
);

select throws_ok(
  format(
    $$insert into public.whatsapp_connections (workspace_id, status)
      values (%L::uuid, 'error')$$,
    :'a_workspace_id'
  ),
  '23514',
  null,
  'a connection cannot be marked error without a reason'
);

-- A live number belongs to exactly one workspace. Without this, inbound
-- messages would route to whichever row was found first.
select throws_ok(
  format(
    $$insert into public.whatsapp_connections
        (workspace_id, status, phone_number_id, waba_id)
      values (%L::uuid, 'connected', 'SYNTHETIC_PHONE_ID_A', 'OTHER_WABA')$$,
    :'b_workspace_id'
  ),
  '23505',
  null,
  'another workspace cannot claim a phone number that is already active'
);

-- ...but a number released by one workspace must be connectable elsewhere,
-- which a table-wide unique index would block forever.
select lives_ok(
  format(
    $$insert into public.whatsapp_connections
        (workspace_id, status, phone_number_id, waba_id, disconnected_at)
      values (%L::uuid, 'disconnected', 'SYNTHETIC_RELEASED_NUMBER', 'W', now())$$,
    :'a_workspace_id'
  ),
  'a disconnected connection may hold a phone number id'
);

select lives_ok(
  format(
    $$insert into public.whatsapp_connections
        (workspace_id, status, phone_number_id, waba_id)
      values (%L::uuid, 'connected', 'SYNTHETIC_RELEASED_NUMBER', 'W')$$,
    :'b_workspace_id'
  ),
  'a different workspace may then connect that released number'
);

-- ---------------------------------------------------------------------------
-- Lifecycle transitions
-- ---------------------------------------------------------------------------

select lives_ok(
  format(
    $$update public.whatsapp_connections set status = 'connected',
        phone_number_id = 'SYNTHETIC_PHONE_ID_B', waba_id = 'SYNTHETIC_WABA_B'
      where id = %L::uuid$$,
    :'b_connection_id'
  ),
  'pending -> connected is allowed'
);

select isnt(
  (select connected_at from public.whatsapp_connections
   where id = :'b_connection_id'::uuid),
  null,
  'connected_at is stamped by the trigger rather than left to the caller'
);

select lives_ok(
  format(
    $$update public.whatsapp_connections set status = 'disconnected'
      where id = %L::uuid$$,
    :'b_connection_id'
  ),
  'connected -> disconnected is allowed'
);

select isnt(
  (select disconnected_at from public.whatsapp_connections
   where id = :'b_connection_id'::uuid),
  null,
  'disconnected_at is stamped by the trigger'
);

select lives_ok(
  format(
    $$update public.whatsapp_connections set status = 'pending'
      where id = %L::uuid$$,
    :'b_connection_id'
  ),
  'disconnected -> pending is allowed, so a number can be reconnected'
);

-- Going straight back to connected from pending without identifiers is caught
-- by the check constraint, and connected -> pending is not a real transition.
select lives_ok(
  format(
    $$update public.whatsapp_connections set status = 'connected'
      where id = %L::uuid$$,
    :'b_connection_id'
  ),
  'pending -> connected is allowed again once identifiers are present'
);

select throws_ok(
  format(
    $$update public.whatsapp_connections set status = 'pending'
      where id = %L::uuid$$,
    :'b_connection_id'
  ),
  '23514',
  null,
  'connected -> pending is rejected'
);

select lives_ok(
  format(
    $$update public.whatsapp_connections set status = 'error', error_code = 'TOKEN_REVOKED'
      where id = %L::uuid$$,
    :'b_connection_id'
  ),
  'connected -> error is allowed'
);

select is(
  (select error_code from public.whatsapp_connections
   where id = :'b_connection_id'::uuid),
  'TOKEN_REVOKED',
  'the error reason is retained'
);

select lives_ok(
  format(
    $$update public.whatsapp_connections set status = 'connected'
      where id = %L::uuid$$,
    :'b_connection_id'
  ),
  'error -> connected is allowed, so a fixed connection can recover'
);

-- ---------------------------------------------------------------------------
-- Tenant isolation
-- ---------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*) from public.whatsapp_connections
   where workspace_id = :'b_workspace_id'::uuid),
  0::bigint,
  'doctor A cannot read doctor B''s connection'
);

select ok(
  (select count(*) from public.whatsapp_connections) > 0,
  'doctor A can read their own workspace''s connections'
);

-- There is deliberately no write policy: connections are created and
-- transitioned by trusted server code holding the secret key.
select throws_ok(
  format(
    $$insert into public.whatsapp_connections (workspace_id, status)
      values (%L::uuid, 'pending')$$,
    :'a_workspace_id'
  ),
  '42501',
  null,
  'a member cannot create a connection directly'
);

-- Privileges are revoked as well as denied by RLS, so this is a hard
-- permission error rather than an empty result set.
select throws_ok(
  'select * from public.whatsapp_connection_secrets',
  '42501',
  null,
  'a member cannot even select from the secrets table'
);

set local role anon;
reset "request.jwt.claims";

select is(
  (select count(*) from public.whatsapp_connections),
  0::bigint,
  'an anonymous caller sees no connections'
);

select * from finish();

rollback;
