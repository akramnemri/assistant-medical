-- Table privileges held by the browser-facing roles.
--
-- Row Level Security is the control this schema relies on, and it only covers
-- SELECT, INSERT, UPDATE and DELETE. A privilege outside that set is a hole no
-- policy can close, which is why these are asserted separately from the policy
-- tests.
--
-- The case that prompted this file: every table carried Supabase's default
-- grant of ALL to `anon` and `authenticated`, which includes TRUNCATE. A
-- signed-in doctor's role could empty `public.messages` — every workspace's
-- patient history — and no policy in this schema would have been consulted.
--
-- Run with: npm run db:test

begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

-- ---------------------------------------------------------------------------
-- Privileges RLS cannot filter
-- ---------------------------------------------------------------------------

select is_empty(
  $$
    select table_name || ' grants ' || privilege_type || ' to ' || grantee
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('anon', 'authenticated')
      and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
  $$,
  'no public table grants TRUNCATE, REFERENCES or TRIGGER to anon or authenticated'
);

-- Named explicitly as well as swept above, because these two hold the data
-- whose loss would be unrecoverable.
select ok(
  not has_table_privilege('authenticated', 'public.messages', 'TRUNCATE'),
  'authenticated cannot truncate messages'
);

select ok(
  not has_table_privilege('anon', 'public.messages', 'TRUNCATE'),
  'anon cannot truncate messages'
);

-- ---------------------------------------------------------------------------
-- Tables that no browser session may touch at all
-- ---------------------------------------------------------------------------

select is_empty(
  $$
    select table_name || ' grants ' || privilege_type || ' to ' || grantee
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('anon', 'authenticated')
      and table_name in ('whatsapp_connection_secrets', 'whatsapp_webhook_events')
  $$,
  'provider credentials and raw webhook payloads are unreachable from any browser role'
);

-- platform_admins keeps SELECT so a user can discover their own grant; the
-- policy narrows that to their own row. Everything else must be absent, or an
-- administrator list becomes self-service.
select is_empty(
  $$
    select privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'platform_admins'
      and grantee in ('anon', 'authenticated')
      and privilege_type <> 'SELECT'
  $$,
  'platform_admins grants nothing beyond SELECT to browser roles'
);

select * from finish();
rollback;
