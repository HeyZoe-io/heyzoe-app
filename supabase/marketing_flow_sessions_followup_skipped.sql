-- Marketing follow-ups: a step cancelled without sending (delayed by night / Shabbat, or past 24h).
-- Until this runs, /api/cron/marketing-followups marks a cancelled step in followup_N_sent_at
-- (the original due time), so it is still never sent late.
-- Idempotent. RUN THIS IN THE SUPABASE SQL EDITOR.

alter table if exists public.marketing_flow_sessions
  add column if not exists followup_1_skipped_at timestamptz null default null;

alter table if exists public.marketing_flow_sessions
  add column if not exists followup_2_skipped_at timestamptz null default null;

alter table if exists public.marketing_flow_sessions
  add column if not exists followup_3_skipped_at timestamptz null default null;
