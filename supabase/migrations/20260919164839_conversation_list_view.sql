-- Conversation list view: each conversation with its newest message.
--
-- A view rather than denormalised `last_message_preview` columns, because the
-- preview is patient content and a copy can drift from the message it claims to
-- summarise. A view cannot disagree with its source.
--
-- A lateral join with `limit 1` is cheap here: the
-- (conversation_id, sent_at desc, id desc) index on messages means each
-- conversation's newest row is an index lookup, not a scan of its history.

-- SECURITY INVOKER IS LOAD-BEARING.
--
-- A Postgres view defaults to running as its *owner*, which would execute these
-- reads as the privileged role and bypass Row Level Security entirely — every
-- doctor would see every other doctor's conversations through this view while
-- the underlying tables stayed correctly locked down. `security_invoker = true`
-- runs the view as the caller, so the policies on conversations, contacts and
-- messages all still apply. A test asserts this option is set.
create view public.conversation_list
with (security_invoker = true)
as
select
  c.id,
  c.workspace_id,
  c.contact_id,
  c.last_message_at,
  c.unread_count,
  contact.wa_id as contact_wa_id,
  contact.profile_name as contact_profile_name,
  newest.text_body as last_message_text,
  newest.direction as last_message_direction,
  newest.message_type as last_message_type
from public.conversations c
join public.contacts contact on contact.id = c.contact_id
left join lateral (
  select m.text_body, m.direction, m.message_type
  from public.messages m
  where m.conversation_id = c.id
  order by m.sent_at desc, m.id desc
  limit 1
) newest on true;

comment on view public.conversation_list is
  'Conversations with their newest message, for the inbox list. security_invoker so RLS applies.';

-- A view is not a table: `anon` has no reason to reach it, and `authenticated`
-- still only sees rows the underlying policies allow.
revoke all on public.conversation_list from anon;
grant select on public.conversation_list to authenticated;
