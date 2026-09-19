-- Conversations and messages: idempotency, ownership, ordering and isolation.
--
-- The most important assertion in this file is that a duplicate provider
-- message id is rejected by the database. Meta retries webhook deliveries, and
-- a handler that "checks first, then inserts" races against its own retry — so
-- the guarantee has to be a constraint, not a code path.
--
-- Run with: npm run db:test

begin;

create extension if not exists pgtap with schema extensions;

select plan(35);

\set doctor_a_id '11111111-1111-1111-1111-111111111111'
\set doctor_b_id '22222222-2222-2222-2222-222222222222'
\set conversation_id '55555555-5555-5555-5555-555555555555'
\set contact_id '33333333-3333-3333-3333-333333333333'

select workspace_id as a_workspace_id
from public.workspace_members where user_id = :'doctor_a_id' \gset

select workspace_id as b_workspace_id
from public.workspace_members where user_id = :'doctor_b_id' \gset

select id as b_connection_id
from public.whatsapp_connections where workspace_id = :'b_workspace_id' \gset

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.contacts'::regclass),
  'RLS is enabled on contacts'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.conversations'::regclass),
  'RLS is enabled on conversations'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.messages'::regclass),
  'RLS is enabled on messages'
);

-- ---------------------------------------------------------------------------
-- Idempotency
-- ---------------------------------------------------------------------------

-- The single most important constraint in the schema.
select throws_ok(
  format(
    $$insert into public.messages
        (workspace_id, conversation_id, direction, message_type,
         provider_message_id, text_body, sent_at)
      values (%L::uuid, %L::uuid, 'inbound', 'text',
              'wamid.SYNTHETIC.1', 'A retried delivery', now())$$,
    :'a_workspace_id', :'conversation_id'
  ),
  '23505',
  null,
  'a duplicate provider message id is rejected'
);

-- The constraint must be global, not per conversation: the same wamid arriving
-- against the wrong conversation is still the same message.
select throws_ok(
  format(
    $$insert into public.messages
        (workspace_id, conversation_id, direction, message_type,
         provider_message_id, text_body, sent_at)
      values (%L::uuid, '66666666-6666-6666-6666-666666666666', 'inbound', 'text',
              'wamid.SYNTHETIC.1', 'Same id, other thread', now())$$,
    :'a_workspace_id'
  ),
  '23505',
  null,
  'the same provider message id is rejected even in another conversation'
);

-- Outbound messages have no provider id until the provider accepts them, so
-- several may legitimately be null at once.
select lives_ok(
  format(
    $$insert into public.messages
        (workspace_id, conversation_id, direction, message_type, text_body, sent_at)
      values (%L::uuid, %L::uuid, 'outbound', 'text', 'Queued reply one', now()),
             (%L::uuid, %L::uuid, 'outbound', 'text', 'Queued reply two', now())$$,
    :'a_workspace_id', :'conversation_id', :'a_workspace_id', :'conversation_id'
  ),
  'multiple outbound messages may have no provider id yet'
);

select throws_ok(
  format(
    $$insert into public.messages
        (workspace_id, conversation_id, direction, message_type, text_body, sent_at)
      values (%L::uuid, %L::uuid, 'inbound', 'text', 'No provider id', now())$$,
    :'a_workspace_id', :'conversation_id'
  ),
  '23514',
  null,
  'an inbound message without a provider id is rejected'
);

select throws_ok(
  format(
    $$insert into public.messages
        (workspace_id, conversation_id, direction, message_type,
         provider_message_id, text_body, delivery_status, sent_at)
      values (%L::uuid, %L::uuid, 'inbound', 'text', 'wamid.NEW.1', 'x', 'sent', now())$$,
    :'a_workspace_id', :'conversation_id'
  ),
  '23514',
  null,
  'an inbound message cannot carry an outbound delivery status'
);

-- ---------------------------------------------------------------------------
-- Ownership cannot be forged
-- ---------------------------------------------------------------------------

-- The composite foreign key is what makes the denormalised workspace_id safe.
select throws_ok(
  format(
    $$insert into public.messages
        (workspace_id, conversation_id, direction, message_type,
         provider_message_id, text_body, sent_at)
      values (%L::uuid, %L::uuid, 'inbound', 'text', 'wamid.FORGED.1', 'x', now())$$,
    :'b_workspace_id', :'conversation_id'
  ),
  '23503',
  null,
  'a message cannot claim a workspace that does not own its conversation'
);

select throws_ok(
  format(
    $$insert into public.conversations (workspace_id, connection_id, contact_id)
      values (%L::uuid, %L::uuid, %L::uuid)$$,
    :'b_workspace_id', :'b_connection_id', :'contact_id'
  ),
  '23503',
  null,
  'a conversation cannot join a contact from another workspace'
);

-- One thread per patient per number, so a webhook race cannot split a history.
select throws_ok(
  format(
    $$insert into public.conversations (workspace_id, connection_id, contact_id)
      select %L::uuid, connection_id, contact_id from public.conversations
      where id = %L::uuid$$,
    :'a_workspace_id', :'conversation_id'
  ),
  '23505',
  null,
  'a second conversation for the same contact and connection is rejected'
);

select throws_ok(
  format(
    $$insert into public.contacts (workspace_id, wa_id)
      values (%L::uuid, '15550000001')$$,
    :'a_workspace_id'
  ),
  '23505',
  null,
  'the same patient cannot be added twice to one workspace'
);

-- ...but the same person messaging a different doctor is a separate contact.
select lives_ok(
  format(
    $$insert into public.contacts (workspace_id, wa_id)
      values (%L::uuid, '15550000001')$$,
    :'b_workspace_id'
  ),
  'the same patient may exist independently in another workspace'
);

-- ---------------------------------------------------------------------------
-- Conversation summary
-- ---------------------------------------------------------------------------

select isnt(
  (select last_message_at from public.conversations where id = :'conversation_id'::uuid),
  null,
  'last_message_at is maintained by the trigger'
);

select ok(
  (select unread_count from public.conversations where id = :'conversation_id'::uuid) > 0,
  'inbound messages increment the unread count'
);

-- Outbound replies are the doctor's own messages, not unread mail.
select unread_count as unread_before
from public.conversations where id = :'conversation_id' \gset

insert into public.messages
  (workspace_id, conversation_id, direction, message_type,
   provider_message_id, text_body, sent_at)
values (:'a_workspace_id'::uuid, :'conversation_id'::uuid,
        'outbound', 'text', 'wamid.OUT.1', 'Reply', now());

select is(
  (select unread_count from public.conversations where id = :'conversation_id'::uuid),
  :'unread_before'::integer,
  'an outbound message does not increase the unread count'
);

-- An out-of-order retry — Meta redelivering an older event after a newer one
-- already landed — must not drag the thread backwards in the list.
select last_message_at as newest_before
from public.conversations where id = :'conversation_id' \gset

insert into public.messages
  (workspace_id, conversation_id, direction, message_type,
   provider_message_id, text_body, sent_at)
values (:'a_workspace_id'::uuid, :'conversation_id'::uuid,
        'inbound', 'text', 'wamid.LATE.1', 'An older delivery arriving late',
        now() - interval '7 days');

select is(
  (select last_message_at from public.conversations where id = :'conversation_id'::uuid),
  :'newest_before'::timestamptz,
  'a late-arriving older message does not move the thread backwards'
);

-- ---------------------------------------------------------------------------
-- Ordering and pagination
-- ---------------------------------------------------------------------------

-- Meta timestamps have one-second resolution, so the seed contains three
-- messages sharing a sent_at. Ordering on the timestamp alone is ambiguous.
select ok(
  (select count(*) from (
     select sent_at from public.messages
     where conversation_id = :'conversation_id'::uuid
     group by sent_at having count(*) > 1
   ) duplicated) > 0,
  'the fixture contains messages that share a timestamp'
);

-- (sent_at, id) is a total order, so a cursor built on it can neither skip nor
-- repeat a row at a page boundary.
select is(
  (select count(distinct (sent_at, id)) from public.messages
   where conversation_id = :'conversation_id'::uuid),
  (select count(*) from public.messages
   where conversation_id = :'conversation_id'::uuid),
  '(sent_at, id) is unique across the thread, so pagination is stable'
);

-- Two pages of five, taken with a keyset cursor, must not overlap.
select is(
  (with page_one as (
     select sent_at, id from public.messages
     where conversation_id = :'conversation_id'::uuid
     order by sent_at desc, id desc
     limit 5
   ),
   cursor_row as (select sent_at, id from page_one order by sent_at, id limit 1),
   page_two as (
     select m.id from public.messages m, cursor_row c
     where m.conversation_id = :'conversation_id'::uuid
       and (m.sent_at, m.id) < (c.sent_at, c.id)
     order by m.sent_at desc, m.id desc
     limit 5
   )
   select count(*) from page_two where id in (select id from page_one)),
  0::bigint,
  'a keyset cursor produces non-overlapping pages'
);

select ok(
  (select count(*) from public.messages
   where conversation_id = :'conversation_id'::uuid) >= 25,
  'the fixture has enough messages to page through'
);

-- ---------------------------------------------------------------------------
-- Tenant isolation
-- ---------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select count(*) from public.messages),
  0::bigint,
  'doctor B sees none of doctor A''s messages'
);

select is(
  (select count(*) from public.conversations),
  0::bigint,
  'doctor B sees none of doctor A''s conversations'
);

select is(
  (select count(*) from public.contacts),
  1::bigint,
  'doctor B sees only the contact in their own workspace'
);

-- Asking for the row by its literal id, rather than relying on a filtered scan.
select is(
  (select count(*) from public.conversations where id = :'conversation_id'::uuid),
  0::bigint,
  'doctor B cannot read doctor A''s conversation by id'
);

select throws_ok(
  format(
    $$insert into public.messages
        (workspace_id, conversation_id, direction, message_type,
         provider_message_id, text_body, sent_at)
      values (%L::uuid, %L::uuid, 'inbound', 'text', 'wamid.INTRUDER', 'x', now())$$,
    :'b_workspace_id', :'conversation_id'
  ),
  '42501',
  null,
  'a member cannot insert a message at all, let alone into another workspace'
);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select ok(
  (select count(*) from public.messages) >= 25,
  'doctor A can read their own workspace''s messages'
);

select ok(
  (select count(*) from public.conversations) = 2,
  'doctor A sees both of their conversations'
);

set local role anon;
reset "request.jwt.claims";

select is(
  (select count(*) from public.messages),
  0::bigint,
  'an anonymous caller sees no messages'
);

select is(
  (select count(*) from public.contacts),
  0::bigint,
  'an anonymous caller sees no patient identities'
);

-- ---------------------------------------------------------------------------
-- conversation_list view
-- ---------------------------------------------------------------------------

reset role;

-- THE assertion for this view. A Postgres view runs as its owner by default,
-- which would execute its reads as the privileged role and bypass RLS
-- entirely: every doctor would see every other doctor's conversations through
-- it while the underlying tables stayed correctly locked down.
select ok(
  (select 'security_invoker=true' = any (reloptions)
   from pg_class where oid = 'public.conversation_list'::regclass),
  'conversation_list is security_invoker, so RLS still applies through it'
);

select ok(
  not has_table_privilege('anon', 'public.conversation_list', 'SELECT'),
  'anon cannot select from the conversation list view'
);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*) from public.conversation_list),
  2::bigint,
  'doctor A sees their two conversations through the view'
);

select isnt(
  (select last_message_text from public.conversation_list
   where id = :'conversation_id'::uuid),
  null,
  'the view attaches the newest message text'
);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- If the view were security definer this would return doctor A's rows.
select is(
  (select count(*) from public.conversation_list),
  0::bigint,
  'doctor B sees nothing through the view'
);

select * from finish();

rollback;
