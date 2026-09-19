-- Enable Realtime for messages and conversations.
--
-- Supabase Realtime only publishes changes for tables added to the
-- `supabase_realtime` publication. Without this the client subscribes happily,
-- receives nothing, and the failure looks like a frontend bug.
--
-- Row Level Security still applies: Realtime evaluates each subscriber's
-- policies before delivering a change, so a doctor is only sent rows their
-- policies already allow them to read. The tests assert that rather than
-- assuming it — a leak here would push another tenant's patient messages
-- straight into the browser, with no request to audit afterwards.

alter publication supabase_realtime add table public.messages;

-- The inbox needs the same treatment: a new message updates its conversation's
-- last_message_at and unread_count through the existing trigger, and that
-- UPDATE is what lets the list re-order itself without a refresh.
alter publication supabase_realtime add table public.conversations;

-- Realtime sends only the primary key for UPDATE and DELETE unless the table
-- has a replica identity that covers more. `full` makes the whole row
-- available, which the conversation list needs to render the new preview and
-- unread count without a follow-up query per event.
--
-- The cost is a larger WAL record per update. Acceptable for tables written at
-- human conversation rates; revisit if bulk updates are ever introduced.
alter table public.conversations replica identity full;
