-- C7 nth_workout — Nth attended class for NEW members (join date within lookback).
-- Scheduling: cron-job.org → GET /api/cron/arbox-daily-triggers (not Vercel crons — Hobby).
-- Grain: (business_id, trigger_id, user_id) — one message per customer per rule.
-- No member_since in PK: a returning member does not get C7 again.
-- delay_days = N (workout count). lookback_days = new-customer window (1–30, NULL = 30).
-- First enable seeds new members already at/past N without WhatsApp.
-- Soft-seed: a new trigger_id with zero log rows is seeded without send.
-- Retry: attempts + status (gated does not increment; only send_failed).
--
-- RUN THIS IN THE SUPABASE SQL EDITOR before deploying app code that uses these objects.

alter table public.template_triggers
  add column if not exists lookback_days integer null;

alter table public.template_triggers
  drop constraint if exists template_triggers_lookback_days_check;

alter table public.template_triggers
  add constraint template_triggers_lookback_days_check
  check (lookback_days is null or (lookback_days >= 1 and lookback_days <= 30));

comment on column public.template_triggers.lookback_days is
  'C7 nth_workout: new-customer window in days (1–30). NULL = 30. Ignored by other trigger types.';

alter table public.businesses
  add column if not exists arbox_nth_workout_seeded boolean not null default false;

comment on column public.businesses.arbox_nth_workout_seeded is
  'True after the first nth_workout pass seeded new members already at/past N without WhatsApp.';

create table if not exists public.arbox_nth_workout_sync_log (
  business_id bigint not null references public.businesses (id) on delete cascade,
  trigger_id uuid not null references public.template_triggers (id) on delete cascade,
  user_id bigint not null,
  contact_id uuid null references public.contacts (id) on delete set null,
  processed_at timestamptz not null default now(),
  attempts int not null default 0,
  status text not null default 'pending',
  primary key (business_id, trigger_id, user_id),
  constraint arbox_nth_workout_sync_log_status_check
    check (status in ('pending', 'seeded', 'sent', 'abandoned', 'no_phone'))
);

create index if not exists idx_arbox_nth_workout_sync_log_processed_at
  on public.arbox_nth_workout_sync_log (processed_at);

comment on table public.arbox_nth_workout_sync_log is
  'C7: one check-in per new member per rule when attended-workout count reaches N. Soft-seed may insert user_id=0.';

comment on column public.arbox_nth_workout_sync_log.user_id is
  'Arbox user_id. Soft-seed may insert user_id=0 as a one-shot sentinel when the cohort is empty.';

comment on column public.arbox_nth_workout_sync_log.attempts is
  'Count of real send_failed attempts. gated does not increment. Cap ARBOX_SYNC_SEND_ATTEMPT_CAP (3).';

comment on column public.arbox_nth_workout_sync_log.status is
  'pending = retry; seeded/sent/abandoned/no_phone = terminal.';

grant select, insert, update, delete
  on public.arbox_nth_workout_sync_log
  to service_role;

alter table public.arbox_nth_workout_sync_log
  enable row level security;
