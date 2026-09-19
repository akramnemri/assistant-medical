-- Workspace / tenant model.
--
-- The workspace is the tenant boundary. Every tenant-owned table added later
-- (whatsapp connections, conversations, messages) carries a workspace_id and
-- reuses the membership helpers defined here, so the isolation rule is written
-- once rather than re-derived per table.
--
-- Row Level Security is the authorization boundary, not a second opinion on
-- one. Application code can be wrong; a policy denies the read anyway.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row per authenticated user. Mirrors auth.users, which is owned by
-- Supabase Auth and should not be joined against directly from application
-- queries or referenced by application foreign keys.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Application-visible user record, 1:1 with auth.users.';

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.workspaces is
  'Tenant boundary. Every tenant-owned row traces back to exactly one workspace.';

-- 'owner' is the doctor who created the workspace; the other roles exist for
-- the team features on the post-MVP roadmap. Enumerated rather than free text
-- so an unrecognised role cannot be stored at all.
create type public.workspace_role as enum ('owner', 'admin', 'member');

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.workspace_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

comment on table public.workspace_members is
  'Membership and role. The primary key makes duplicate membership impossible.';

-- The primary key already indexes (workspace_id, user_id), which serves lookups
-- by workspace. "Which workspaces does this user belong to?" is the other hot
-- query — it runs on every request — and needs user_id to lead.
create index workspace_members_user_id_idx
  on public.workspace_members (user_id);

-- ---------------------------------------------------------------------------
-- Membership helpers
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER is load-bearing here, not a shortcut.
--
-- A policy on workspace_members that queried workspace_members would recurse
-- infinitely. Running the lookup as the function owner bypasses RLS on that
-- one read and breaks the cycle.
--
-- `search_path = ''` prevents a caller-controlled search_path from resolving
-- these identifiers to a different table, which is the classic SECURITY
-- DEFINER privilege-escalation route. Every name below is schema-qualified.
create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = (select auth.uid())
  );
$$;

comment on function public.is_workspace_member(uuid) is
  'True when the current user belongs to the workspace. SECURITY DEFINER to avoid RLS recursion.';

create or replace function public.has_workspace_role(
  p_workspace_id uuid,
  p_roles public.workspace_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = (select auth.uid())
      and wm.role = any (p_roles)
  );
$$;

-- ---------------------------------------------------------------------------
-- Keeping updated_at honest
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Provisioning a new user
-- ---------------------------------------------------------------------------

-- Creates the profile, a workspace, and the owner membership as one unit.
--
-- A user with no workspace cannot use the product at all, and a workspace with
-- no owner is unreachable. Doing this in application code would leave both
-- states possible whenever a request failed midway; a single trigger makes them
-- unrepresentable.
--
-- Trade-off: this runs inside the auth.users insert, so a failure here fails
-- the sign-up. That is the intended behaviour — a half-provisioned account is
-- worse than a rejected one — but it does mean a bug in this function breaks
-- all registration.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_workspace_name text;
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''));

  -- Derived from the email local part purely so the workspace has a
  -- recognisable name before the doctor renames it.
  v_workspace_name := coalesce(
    nullif(btrim(split_part(coalesce(new.email, ''), '@', 1)), ''),
    'My'
  ) || ' workspace';

  insert into public.workspaces (name)
  values (left(v_workspace_name, 120))
  returning id into v_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, new.id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

-- profiles ------------------------------------------------------------------
-- Deliberately own-profile-only. Letting members read each other's profiles is
-- a team feature, and is not granted before something needs it.

create policy "Users read their own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Users update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No insert or delete policy: profiles are created by the sign-up trigger and
-- removed by the cascade from auth.users. Absent policies deny.

-- workspaces ----------------------------------------------------------------

create policy "Members read their workspaces"
  on public.workspaces for select
  to authenticated
  using (public.is_workspace_member(id));

create policy "Owners and admins update their workspace"
  on public.workspaces for update
  to authenticated
  using (public.has_workspace_role(id, array['owner', 'admin']::public.workspace_role[]))
  with check (public.has_workspace_role(id, array['owner', 'admin']::public.workspace_role[]));

create policy "Owners delete their workspace"
  on public.workspaces for delete
  to authenticated
  using (public.has_workspace_role(id, array['owner']::public.workspace_role[]));

-- No insert policy. A workspace created by a bare insert would have no owner
-- and be immediately unreachable, so creation goes through
-- public.create_workspace() below, which creates both rows together.

-- workspace_members ---------------------------------------------------------

create policy "Members read the membership of their workspaces"
  on public.workspace_members for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

-- No insert, update or delete policy. Inviting and removing members is a team
-- feature that does not exist yet, and an unused write policy is a hole nobody
-- is testing. The sign-up trigger creates the owner row as SECURITY DEFINER.

-- ---------------------------------------------------------------------------
-- Creating additional workspaces
-- ---------------------------------------------------------------------------

-- Atomic workspace creation: the workspace and its owner membership are
-- inserted together or not at all.
--
-- SECURITY DEFINER because there is intentionally no insert policy on either
-- table. The function is the only supported way in, and it always makes the
-- caller the owner — it cannot be used to join a workspace that already exists.
create or replace function public.create_workspace(p_name text)
returns public.workspaces
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_workspace public.workspaces;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'workspace name is required' using errcode = '22023';
  end if;

  insert into public.workspaces (name)
  values (left(btrim(p_name), 120))
  returning * into v_workspace;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace.id, v_user_id, 'owner');

  return v_workspace;
end;
$$;

-- SECURITY DEFINER functions are executable by PUBLIC unless revoked, which
-- would let an unauthenticated caller reach them.
revoke execute on function public.create_workspace(text) from public, anon;
grant execute on function public.create_workspace(text) to authenticated;

revoke execute on function public.is_workspace_member(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;

revoke execute on function public.has_workspace_role(uuid, public.workspace_role[])
  from public, anon;
grant execute on function public.has_workspace_role(uuid, public.workspace_role[])
  to authenticated;
