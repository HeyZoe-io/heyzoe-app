-- Trial-class reminder (future bookingsReport, C4 trial name-match, no salesReport join).
-- Scheduling: cron-job.org → GET /api/cron/arbox-daily-triggers (not Vercel crons — Hobby).
-- Grain: no booking_id on the report → (user_id, class_date, class_time, class_name)
--   same composite as missed-class.
-- First enable seeds upcoming trial bookings in the fetch window without WhatsApp
--   (arbox_trial_reminder_seeded). Soft-seed: flag already true + empty log.
-- Empty cohort still gets a one-shot sentinel (user_id=0).
-- Retry: attempts + status (gated does not increment; only send_failed).
-- Cap ARBOX_SYNC_SEND_ATTEMPT_CAP (3) → abandoned.
-- Requires configured trial products (product_filter or arbox_trial_membership_type_ids);
--   no name heuristic — without scope the handler no-ops.
--
-- RUN THIS IN THE SUPABASE SQL EDITOR before deploying app code that uses this table.

alter table public.businesses
  add column if not exists arbox_trial_reminder_seeded boolean not null default false;

comment on column public.businesses.arbox_trial_reminder_seeded is
  'True after the first trial_reminder bookingsReport pass seeded upcoming trial bookings without sending WhatsApp.';

create table if not exists public.arbox_trial_reminder_sync_log (
  business_id bigint not null references public.businesses (id) on delete cascade,
  user_id bigint not null,
  class_date date not null,
  class_time text not null,
  class_name text not null,
  contact_id uuid null references public.contacts (id) on delete set null,
  processed_at timestamptz not null default now(),
  attempts int not null default 0,
  status text not null default 'pending',
  primary key (business_id, user_id, class_date, class_time, class_name),
  constraint arbox_trial_reminder_sync_log_status_check
    check (status in ('pending', 'seeded', 'sent', 'abandoned', 'no_phone'))
);

create index if not exists idx_arbox_trial_reminder_sync_log_processed_at
  on public.arbox_trial_reminder_sync_log (processed_at);

comment on table public.arbox_trial_reminder_sync_log is
  'trial_reminder: one UTILITY send per upcoming trial booking. PK business_id+user_id+class_date+class_time+class_name.';

comment on column public.arbox_trial_reminder_sync_log.class_time is
  'Trimmed bookingsReport.time (text grain). Sentinel uses "-".';

comment on column public.arbox_trial_reminder_sync_log.class_name is
  'Trimmed bookingsReport.class_name (text grain). Sentinel uses "seed".';

comment on column public.arbox_trial_reminder_sync_log.attempts is
  'Count of real send_failed attempts. gated does not increment. Cap ARBOX_SYNC_SEND_ATTEMPT_CAP (3).';

comment on column public.arbox_trial_reminder_sync_log.status is
  'pending = retry; seeded/sent/abandoned/no_phone = terminal.';

grant select, insert, update, delete
  on public.arbox_trial_reminder_sync_log
  to authenticated;

grant select, insert, update, delete
  on public.arbox_trial_reminder_sync_log
  to service_role;

alter table public.arbox_trial_reminder_sync_log
  enable row level security;
