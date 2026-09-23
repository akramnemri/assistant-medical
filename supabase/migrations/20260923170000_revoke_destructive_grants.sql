-- Remove privileges the browser roles should never have held.
--
-- Found during first-milestone hardening. Every table created so far carried
-- Supabase's default grant of ALL privileges to `anon` and `authenticated`,
-- which includes TRUNCATE, REFERENCES and TRIGGER. The two tables that used
-- `revoke all` were clean; everything else was not.
--
-- **TRUNCATE is the one that matters. Row Level Security does not apply to
-- it.** Every policy in this schema is written to keep one workspace out of
-- another's rows, and TRUNCATE ignores all of them. Verified against the local
-- database: `set role authenticated; truncate public.messages;` removed all 75
-- seeded messages across both workspaces.
--
-- It is not reachable through PostgREST today, which does not expose TRUNCATE
-- — so this is a latent privilege rather than a live hole. It is still wrong:
-- the guarantee this product rests on is that a tenant session cannot destroy
-- another tenant's patient data, and that guarantee should not depend on which
-- statements the API gateway happens not to expose.
--
-- REFERENCES and TRIGGER go too. Neither is escalatable right now (`anon` and
-- `authenticated` have no CREATE on the schema, so no trigger function can be
-- defined) and neither has any legitimate use from a browser session.
--
-- SELECT, INSERT, UPDATE and DELETE are deliberately left alone: those are the
-- privileges RLS filters, and they are how the application reads and writes.

revoke truncate, references, trigger
  on all tables in schema public
  from anon, authenticated;

-- Tables added by later migrations would otherwise inherit the same default.
-- Scoped to the role that owns the migrations, which is what creates them.
alter default privileges in schema public
  revoke truncate, references, trigger on tables
  from anon, authenticated;
