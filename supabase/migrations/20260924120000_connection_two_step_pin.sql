-- The two-step verification PIN for a registered business phone number.
--
-- Registering a number with the Cloud API sets a six-digit two-step PIN, and
-- Meta requires the same PIN on every later re-registration of that number. A
-- PIN we generate and then forget would lock the practice out of its own
-- number: reconnecting would fail, and the only recovery is Meta support.
--
-- Stored beside the access token rather than on the connection, because it is
-- a credential with the same blast radius — anyone holding it can re-register
-- the number elsewhere. This table has no RLS policy at all and its privileges
-- are revoked, so only server code holding the secret key can read it.

alter table public.whatsapp_connection_secrets
  add column two_step_pin text
    check (two_step_pin is null or two_step_pin ~ '^[0-9]{6}$');

comment on column public.whatsapp_connection_secrets.two_step_pin is
  'Six-digit Cloud API two-step verification PIN. Required again on every re-registration; losing it locks the number.';
