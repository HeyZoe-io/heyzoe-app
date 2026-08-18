-- CTA frequency cap + self-reported registration (follow-up suppression).
-- Run in Supabase SQL Editor. Scheduling of follow-up crons is external (cron-job.org), not Vercel.
-- Existing rows: both columns have defaults / null so current contacts stay valid.

alter table if exists public.contacts
  add column if not exists free_text_replies_since_cta smallint not null default 0;

alter table if exists public.contacts
  add column if not exists self_reported_registered_at timestamptz null;

comment on column public.contacts.free_text_replies_since_cta is
  'Count of Claude free-text replies since the last sales-flow CTA menu send. Reset to 0 on CTA send and on greeting reset.';

comment on column public.contacts.self_reported_registered_at is
  'Set when the lead says they already registered (keyword). Suppresses WA follow-ups / no-response; does not set trial_registered.';
