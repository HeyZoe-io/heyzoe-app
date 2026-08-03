-- Trial-attended trigger detection (Arbox trialClassesReport + check_in).
-- Scheduling: cron-job.org → GET /api/cron/arbox-daily-triggers (3rd step; not Vercel crons).
-- One day-after (or delay-mapped) message per user per trial class_date.
-- No seed flag — fetch only the mapped class_date, not history.
-- Server-side only (service_role); RLS enabled with no client policies (= deny-all).

create table if not exists public.arbox_trial_attended_sync_log (
  business_id bigint not null references public.businesses (id) on delete cascade,
  user_id bigint not null,
  class_date date not null,
  contact_id uuid null references public.contacts (id) on delete set null,
  processed_at timestamptz not null default now(),
  primary key (business_id, user_id, class_date)
);

create index if not exists idx_arbox_trial_attended_sync_log_processed_at
  on public.arbox_trial_attended_sync_log (processed_at);

comment on table public.arbox_trial_attended_sync_log is
  'Arbox trial_attended triggers already processed (one message per user per trial class day).';

comment on column public.arbox_trial_attended_sync_log.class_date is
  'Trial class date from trialClassesReport.date (not start_time — avoids null PK issues).';

grant select, insert, update, delete
  on public.arbox_trial_attended_sync_log
  to service_role;

alter table public.arbox_trial_attended_sync_log
  enable row level security;
