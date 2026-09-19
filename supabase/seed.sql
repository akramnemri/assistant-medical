-- Local development seed. Runs automatically after `npm run db:reset`.
--
-- Everything here is synthetic. `.test` is reserved by RFC 2606 and can never
-- route to a real mailbox, and the password below is a throwaway that exists
-- only in this file and only in local Docker.
--
-- NEVER add a real email address, real phone number, or a password used
-- anywhere else to this file — it is committed to the repository.
--
--   doctor-a@example.test / devpassword123
--   doctor-b@example.test / devpassword123
--
-- Two accounts rather than one, because tenant isolation cannot be checked by
-- hand with a single workspace.

-- Sign-up provisioning (profile, workspace, owner membership) is handled by the
-- on_auth_user_created trigger, so inserting the auth user is enough.
-- The *_token columns are set to '' rather than left NULL: GoTrue scans them
-- into Go strings and fails the whole sign-in with
-- "converting NULL to string is unsupported" if any of them is NULL. The
-- symptom is a 500 from /token with no hint that the seed is at fault.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at,
   raw_app_meta_data, raw_user_meta_data,
   confirmation_token, recovery_token, email_change,
   email_change_token_new, email_change_token_current,
   phone_change, phone_change_token, reauthentication_token)
values
  ('00000000-0000-0000-0000-000000000000',
   '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'doctor-a@example.test',
   extensions.crypt('devpassword123', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000',
   '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'doctor-b@example.test',
   extensions.crypt('devpassword123', extensions.gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
   '', '', '', '', '', '', '', '');

-- An identity row is what lets these accounts sign in with a password; without
-- it GoTrue does not consider the email a usable login method.
insert into auth.identities
  (id, user_id, identity_data, provider, provider_id,
   last_sign_in_at, created_at, updated_at)
select
  gen_random_uuid(),
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email',
  u.id::text,
  now(), now(), now()
from auth.users u
where u.email in ('doctor-a@example.test', 'doctor-b@example.test');

-- One WhatsApp connection per workspace, in different lifecycle states, so the
-- connection UI and the cross-tenant checks have something real to show.
insert into public.whatsapp_connections
  (workspace_id, status, phone_number_id, waba_id,
   display_phone_number, verified_name, connected_at)
select
  wm.workspace_id,
  'connected'::public.whatsapp_connection_status,
  'SYNTHETIC_PHONE_ID_A',
  'SYNTHETIC_WABA_A',
  '+1 555 0100',
  'Doctor A Clinic (synthetic)',
  now()
from public.workspace_members wm
where wm.user_id = '11111111-1111-1111-1111-111111111111';

-- Doctor B's is still mid-onboarding, which is the state the connection screen
-- most needs to render correctly.
insert into public.whatsapp_connections
  (workspace_id, status, waba_id)
select
  wm.workspace_id,
  'pending'::public.whatsapp_connection_status,
  'SYNTHETIC_WABA_B'
from public.workspace_members wm
where wm.user_id = '22222222-2222-2222-2222-222222222222';

-- A synthetic credential, purely so the "secrets are unreachable from the
-- browser" test has a row to fail to read.
insert into public.whatsapp_connection_secrets (connection_id, access_token)
select c.id, 'SYNTHETIC_TOKEN_NOT_A_REAL_CREDENTIAL'
from public.whatsapp_connections c
where c.phone_number_id = 'SYNTHETIC_PHONE_ID_A';
