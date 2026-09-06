-- Missed-class / missed-trial triggers (Arbox bookingsReport check_in = 'No').
-- Scheduling: cron-job.org → GET /api/cron/arbox-daily-triggers (not Vercel crons — Hobby).
-- Shared by C3 (missed_class / members) and C4 (missed_trial / leads).
-- Grain: no booking_id on the report → (user_id, class_date, class_time, class_name).
-- First enable seeds past no-shows without WhatsApp (arbox_missed_class_seeded).
-- Retry cap: attempts + status (gated does not increment; only send_failed).
--
-- RUN THIS IN THE SUPABASE SQL EDITOR before deploying app code that uses the table.

alter table public.businesses
  add column if not exists arbox_missed_class_seeded boolean not null default false;

comment on column public.businesses.arbox_missed_class_seeded is
  'True after the first missed_class/missed_trial bookingsReport pass seeded past no-shows without sending WhatsApp.';

create table if not exists public.arbox_missed_class_sync_log (
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
  constraint arbox_missed_class_sync_log_status_check
    check (status in ('pending', 'seeded', 'sent', 'abandoned', 'no_phone'))
);

create index if not exists idx_arbox_missed_class_sync_log_processed_at
  on public.arbox_missed_class_sync_log (processed_at);

comment on table public.arbox_missed_class_sync_log is
  'bookingsReport no-shows already processed/seeded. Shared by missed_class (C3) and missed_trial (C4). PK business_id+user_id+class_date+class_time+class_name.';

comment on column public.arbox_missed_class_sync_log.class_time is
  'Trimmed bookingsReport.time (text grain).';

comment on column public.arbox_missed_class_sync_log.class_name is
  'Trimmed bookingsReport.class_name (text grain).';

comment on column public.arbox_missed_class_sync_log.attempts is
  'Count of real send_failed attempts. gated does not increment. Cap ARBOX_SYNC_SEND_ATTEMPT_CAP (3).';

comment on column public.arbox_missed_class_sync_log.status is
  'pending = retry; seeded/sent/abandoned/no_phone = terminal.';

grant select, insert, update, delete
  on public.arbox_missed_class_sync_log
  to service_role;

alter table public.arbox_missed_class_sync_log
  enable row level security;
