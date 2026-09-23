-- Platform administrators.
--
-- Distinct from workspace roles, and deliberately a separate axis. A workspace
-- 'owner' or 'admin' administers *their own practice*; a platform admin reviews
-- and approves accounts across every tenant. Conflating them would mean every
-- doctor who owns a workspace could review every other doctor.
--
-- **Why this is its own table rather than a column on `profiles`:** profiles
-- carries a "users update their own profile" policy. A boolean there would be
-- writable by its own subject, so any doctor could promote themselves to
-- platform admin with a single PATCH. Here there is no update policy at all,
-- and the privileges below are revoked outright.
--
-- Membership is granted out of band — by a migration, by an operator with the
-- service key, or eventually by an approval workflow. There is intentionally no
-- application path that creates a platform admin.

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,

  -- Who granted it and when. An audit trail matters more here than anywhere
  -- else in the schema: this is the account that can see across tenants.
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users (id) on delete set null,
  note text
);

comment on table public.platform_admins is
  'Cross-tenant administrators. Readable only by the subject; writable only by service_role.';

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table public.platform_admins enable row level security;

-- A user may see whether they themselves are an admin, which is what the UI
-- needs to decide whether to render the admin navigation. Nobody can read
-- anyone else's row: the list of administrators is not public information.
create policy "Admins read their own grant"
  on public.platform_admins for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- No insert, update or delete policy. Absent policies deny, and the revoke
-- below means even a future policy added by mistake cannot make these writable
-- from a browser session.
revoke insert, update, delete on public.platform_admins from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Predicate
-- ---------------------------------------------------------------------------

-- `security definer` so the check does not depend on the caller's own read
-- policy, matching how is_workspace_member() and has_workspace_role() work.
-- `search_path = ''` prevents a malicious search_path from resolving these
-- table references somewhere else.
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = (select auth.uid())
  );
$$;

comment on function public.is_platform_admin() is
  'True when the calling user is a platform administrator. Safe to use in policies.';

revoke execute on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Granting one locally
-- ---------------------------------------------------------------------------
--
-- No platform admin is seeded, so /admin is closed to every account by default
-- — including both seeded doctors, which is what the tests assert. To grant one
-- against the local stack, run with the service key:
--
--   insert into public.platform_admins (user_id, note)
--   values ('<auth.users.id>', 'local development');
