-- A7 lost_lead win-back (lostLeadsReport).
-- Scheduling: cron-job.org → GET /api/cron/arbox-daily-triggers (not Vercel crons — Hobby).
-- Grain: (business_id, lead_id, lost_date) — trimmed report lost_date text (A9 cancelled_time grain).
-- Sequences: later run supabase/arbox_lost_lead_sync_log_trigger_id.sql (PK adds trigger_id).
-- A new lost_date for the same lead_id is a new PK → re-entry can fire again.
-- First enable seeds the 30-day window without WhatsApp (arbox_lost_lead_seeded).
-- Soft-seed: flag already true + empty sync_log (rule added later) marks the 30-day cohort
--   without send; empty cohort still gets a one-shot sentinel (lead_id=0).
-- After seed, lookback is 3 days. Retry: attempts + status (gated does not increment;
--   only send_failed). Cap ARBOX_SYNC_SEND_ATTEMPT_CAP (3) → abandoned.
--
-- RUN THIS IN THE SUPABASE SQL EDITOR before deploying app code that uses this table.

alter table public.businesses
  add column if not exists arbox_lost_lead_seeded boolean not null default false;

comment on column public.businesses.arbox_lost_lead_seeded is
  'True after the first lost_lead lostLeadsReport pass seeded the seen log without sending WhatsApp.';

create table if not exists public.arbox_lost_lead_sync_log (
  business_id bigint not null references public.businesses (id) on delete cascade,
  lead_id bigint not null,
  lost_date text not null,
  contact_id uuid null references public.contacts (id) on delete set null,
  processed_at timestamptz not null default now(),
  attempts int not null default 0,
  status text not null default 'pending',
  primary key (business_id, lead_id, lost_date),
  constraint arbox_lost_lead_sync_log_status_check
    check (status in ('pending', 'seeded', 'sent', 'abandoned', 'no_phone'))
);

create index if not exists idx_arbox_lost_lead_sync_log_processed_at
  on public.arbox_lost_lead_sync_log (processed_at);

comment on table public.arbox_lost_lead_sync_log is
  'A7 lost_lead win-back: one MARKETING send per lead_id + trimmed lostLeadsReport.lost_date.';

comment on column public.arbox_lost_lead_sync_log.lead_id is
  'Arbox lead_id from lostLeadsReport (same as user_id). Soft-seed may insert lead_id=0 as a one-shot sentinel when the cohort is empty.';

comment on column public.arbox_lost_lead_sync_log.lost_date is
  'Trimmed raw lostLeadsReport.lost_date (text grain; not a timestamptz). Sentinel uses 1970-01-01.';

comment on column public.arbox_lost_lead_sync_log.attempts is
  'Count of real send_failed attempts. gated does not increment. Cap ARBOX_SYNC_SEND_ATTEMPT_CAP (3).';

comment on column public.arbox_lost_lead_sync_log.status is
  'pending = retry; seeded/sent/abandoned/no_phone = terminal.';

grant select, insert, update, delete
  on public.arbox_lost_lead_sync_log
  to authenticated;

grant select, insert, update, delete
  on public.arbox_lost_lead_sync_log
  to service_role;

alter table public.arbox_lost_lead_sync_log
  enable row level security;
