-- Row Level Security tests for the workspace/tenant model.
--
-- These assert the *denied* paths as much as the allowed ones. A policy that
-- grants correctly but fails to deny looks identical from the application right
-- up until one doctor sees another doctor's patients.
--
-- Two techniques matter here:
--
-- 1. Cross-tenant writes are attempted with a *literal* workspace id captured
--    before the role switch. Deriving the target from a sub-select instead
--    makes the test pass for the wrong reason: RLS filters the sub-select to
--    zero rows, the write becomes a harmless no-op, and the policy itself is
--    never exercised.
-- 2. A blocked UPDATE or DELETE does not raise — it simply matches no row — so
--    those are verified afterwards from a privileged connection by checking
--    that the data is unchanged.
--
-- Run with: npx supabase test db

begin;

create extension if not exists pgtap with schema extensions;

select plan(29);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- All data is synthetic. `.test` is reserved by RFC 2606 and cannot route to a
-- real mailbox.

\set doctor_a_id '11111111-1111-1111-1111-111111111111'
\set doctor_b_id '22222222-2222-2222-2222-222222222222'

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at,
   raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', :'doctor_a_id', 'authenticated',
   'authenticated', 'doctor-a@example.test', 'synthetic-not-a-real-hash',
   now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', :'doctor_b_id', 'authenticated',
   'authenticated', 'doctor-b@example.test', 'synthetic-not-a-real-hash',
   now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

-- Captured while still privileged, so the cross-tenant attempts below can name
-- doctor B's workspace directly.
select workspace_id as b_workspace_id
from public.workspace_members
where user_id = :'doctor_b_id' \gset

select name as b_workspace_name
from public.workspaces
where id = :'b_workspace_id' \gset

-- ---------------------------------------------------------------------------
-- RLS is actually switched on
-- ---------------------------------------------------------------------------
-- Without this, every policy below could pass while the table was wide open:
-- a table with RLS disabled ignores its policies entirely.

select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'RLS is enabled on profiles'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.workspaces'::regclass),
  'RLS is enabled on workspaces'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.workspace_members'::regclass),
  'RLS is enabled on workspace_members'
);

-- ---------------------------------------------------------------------------
-- Sign-up provisioning
-- ---------------------------------------------------------------------------

select is(
  (select count(*) from public.profiles where id = :'doctor_a_id'),
  1::bigint,
  'creating an auth user creates exactly one profile'
);

select is(
  (select count(*) from public.workspace_members where user_id = :'doctor_a_id'),
  1::bigint,
  'creating an auth user creates exactly one membership'
);

select is(
  (select role from public.workspace_members where user_id = :'doctor_a_id'),
  'owner'::public.workspace_role,
  'the new user owns their workspace'
);

select isnt(
  (select workspace_id from public.workspace_members where user_id = :'doctor_a_id'),
  :'b_workspace_id'::uuid,
  'each user is provisioned into a separate workspace'
);

-- ---------------------------------------------------------------------------
-- What doctor A can see
-- ---------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*) from public.workspaces),
  1::bigint,
  'doctor A sees exactly one workspace'
);

select is(
  (select count(*) from public.profiles),
  1::bigint,
  'doctor A sees only their own profile'
);

select is(
  (select email from public.profiles),
  'doctor-a@example.test',
  'the profile doctor A sees is their own'
);

select is(
  (select count(*) from public.workspace_members),
  1::bigint,
  'doctor A sees only their own membership'
);

-- The core tenant-isolation assertion, by literal id.
select is(
  (select count(*) from public.workspaces where id = :'b_workspace_id'::uuid),
  0::bigint,
  'doctor A cannot read doctor B''s workspace'
);

select is(
  (select count(*) from public.workspace_members
   where workspace_id = :'b_workspace_id'::uuid),
  0::bigint,
  'doctor A cannot read doctor B''s membership rows'
);

-- ---------------------------------------------------------------------------
-- What doctor A cannot write
-- ---------------------------------------------------------------------------

-- Joining someone else's workspace by inserting a membership row is the most
-- direct attack on tenant isolation.
select throws_ok(
  format(
    $$insert into public.workspace_members (workspace_id, user_id, role)
      values (%L::uuid, %L::uuid, 'owner')$$,
    :'b_workspace_id', :'doctor_a_id'
  ),
  '42501',
  null,
  'doctor A cannot add themselves to doctor B''s workspace'
);

select throws_ok(
  $$insert into public.workspaces (name) values ('Smuggled workspace')$$,
  '42501',
  null,
  'a workspace cannot be created by a direct insert'
);

select throws_ok(
  $$insert into public.profiles (id, email)
    values ('33333333-3333-3333-3333-333333333333', 'intruder@example.test')$$,
  '42501',
  null,
  'a profile cannot be created by a direct insert'
);

-- These match no visible row, so they succeed while changing nothing. The
-- assertions that they had no effect are made from a privileged connection
-- further down.
update public.profiles
set full_name = 'Renamed by doctor A'
where id = :'doctor_b_id'::uuid;

update public.workspaces
set name = 'Renamed by doctor A'
where id = :'b_workspace_id'::uuid;

delete from public.workspaces where id = :'b_workspace_id'::uuid;

-- ---------------------------------------------------------------------------
-- What doctor A can do inside their own workspace
-- ---------------------------------------------------------------------------

select lives_ok(
  $$update public.profiles set full_name = 'Doctor A'
    where id = '11111111-1111-1111-1111-111111111111'$$,
  'doctor A can update their own profile'
);

select is(
  (select full_name from public.profiles where id = :'doctor_a_id'::uuid),
  'Doctor A',
  'the update to doctor A''s own profile was applied'
);

select lives_ok(
  $$update public.workspaces set name = 'Renamed by owner'$$,
  'an owner can rename their own workspace'
);

-- create_workspace() is the only supported way to create a workspace, and it
-- must make the caller the owner.
select lives_ok(
  $$select public.create_workspace('Second clinic')$$,
  'an authenticated user can create a workspace through the function'
);

select is(
  (select count(*) from public.workspaces),
  2::bigint,
  'the newly created workspace is visible to its creator'
);

select is(
  (select count(*) from public.workspace_members where role = 'owner'),
  2::bigint,
  'the creator is made owner of the new workspace'
);

-- ---------------------------------------------------------------------------
-- Doctor B's data survived doctor A's attempts
-- ---------------------------------------------------------------------------

reset role;
-- RESET rather than `set ... to null` (a syntax error for a custom GUC) or
-- set_config (whose result row TAP would parse as a phantom test).
reset "request.jwt.claims";

select is(
  (select full_name from public.profiles where id = :'doctor_b_id'::uuid),
  null,
  'doctor B''s profile was not modified'
);

select is(
  (select name from public.workspaces where id = :'b_workspace_id'::uuid),
  :'b_workspace_name',
  'doctor B''s workspace was not renamed'
);

select is(
  (select count(*) from public.workspaces where id = :'b_workspace_id'::uuid),
  1::bigint,
  'doctor B''s workspace was not deleted'
);

select is(
  (select count(*) from public.workspace_members
   where workspace_id = :'b_workspace_id'::uuid),
  1::bigint,
  'doctor B''s workspace gained no members'
);

-- ---------------------------------------------------------------------------
-- Anonymous callers
-- ---------------------------------------------------------------------------

set local role anon;

select is(
  (select count(*) from public.workspaces),
  0::bigint,
  'an anonymous caller sees no workspaces'
);

select is(
  (select count(*) from public.profiles),
  0::bigint,
  'an anonymous caller sees no profiles'
);

select is(
  (select count(*) from public.workspace_members),
  0::bigint,
  'an anonymous caller sees no memberships'
);

select * from finish();

rollback;
