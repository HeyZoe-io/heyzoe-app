-- M1 recurring bulk-send (weekly). One-off jobs stay on manual_bulk_jobs.
-- Drain: existing cron-job.org → GET /api/cron/scheduled-template-sends (not a Vercel cron).
-- Materializer runs on that same tick, then enqueueManualBulkSend creates a one-off job.
-- RUN THIS IN THE SUPABASE SQL EDITOR before deploying app code that uses these objects.

create table if not exists public.manual_bulk_schedules (
  id uuid primary key default gen_random_uuid(),
  business_id bigint not null references public.businesses (id) on delete cascade,
  created_by uuid null,
  audience_type text not null
    check (audience_type in ('membership', 'talked_not_registered')),
  audience_params jsonb not null default '{}'::jsonb,
  template_name text not null,
  weekday smallint not null
    check (weekday >= 0 and weekday <= 6),
  time_local text not null
    check (time_local ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  enabled boolean not null default true,
  next_run_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_manual_bulk_schedules_due
  on public.manual_bulk_schedules (next_run_at)
  where enabled = true;

create index if not exists idx_manual_bulk_schedules_business
  on public.manual_bulk_schedules (business_id, created_at desc);

comment on table public.manual_bulk_schedules is
  'Living weekly M1 campaign. Each due tick materializes a new manual_bulk_jobs snapshot with a fresh audience.';

comment on column public.manual_bulk_schedules.weekday is
  'Israel weekday: 0=Sunday … 6=Saturday (JS getDay).';

comment on column public.manual_bulk_schedules.time_local is
  'Israel wall HH:mm. Occurrence due_at = that weekday+time.';

alter table public.manual_bulk_jobs
  add column if not exists schedule_id uuid null
  references public.manual_bulk_schedules (id) on delete set null;

create index if not exists idx_manual_bulk_jobs_schedule_id
  on public.manual_bulk_jobs (schedule_id)
  where schedule_id is not null;

comment on column public.manual_bulk_jobs.schedule_id is
  'Set when this job was materialized from a weekly schedule. Null for one-off M1.';

create table if not exists public.manual_bulk_schedule_runs (
  schedule_id uuid not null references public.manual_bulk_schedules (id) on delete cascade,
  occurrence_ymd date not null,
  job_id uuid null references public.manual_bulk_jobs (id) on delete set null,
  materialized_at timestamptz not null default now(),
  primary key (schedule_id, occurrence_ymd)
);

comment on table public.manual_bulk_schedule_runs is
  'One row per schedule per Israel calendar date. Blocks a second materialize of the same Sunday.';

comment on column public.manual_bulk_schedules.audience_type is
  'membership or talked_not_registered. Recurring skips manual_bulk_send_log so week 2 can re-message.';

grant select, insert, update, delete
  on public.manual_bulk_schedules,
     public.manual_bulk_schedule_runs
  to service_role;

alter table public.manual_bulk_schedules enable row level security;
alter table public.manual_bulk_schedule_runs enable row level security;
