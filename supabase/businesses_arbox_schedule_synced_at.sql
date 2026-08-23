-- Arbox programmatic timetable sync watermark (Stage 1).
-- Safe to re-run. Nullable, no default — existing rows stay NULL until the first successful pull.
-- Scheduling of /api/cron/arbox-schedule-sync is external (cron-job.org), not Vercel.
--
-- HOW TO RUN (Supabase Dashboard → SQL Editor):
-- The error "Too small: expected string to have >=1 characters" is from an EMPTY QUERY NAME,
-- not from this SQL. The Name / Title field above the editor must have at least one character.
--
--   1. SQL Editor → New query
--   2. Query name: arbox_schedule_synced_at
--   3. Paste ONLY the ALTER below into the SQL body (not into the name field)
--   4. Run
--
-- Verify (separate query, also needs a name e.g. verify_arbox_schedule_synced_at):
--   select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--   where table_schema = 'public'
--     and table_name = 'businesses'
--     and column_name = 'arbox_schedule_synced_at';

alter table public.businesses
  add column if not exists arbox_schedule_synced_at timestamptz;

comment on column public.businesses.arbox_schedule_synced_at is
  'Last successful Arbox timetable pull (cron or manual). Null until the first successful sync.';
