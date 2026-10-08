-- Did the Arbox daily trigger run finish, per business / Israel day / slot.
-- Written by GET /api/cron/arbox-daily-triggers (cron-job.org). The 20:20 job
-- ?slot=evening&pass=retry reruns only businesses whose 20:00 run is 'incomplete'.
-- Until this runs, the in-run retry still works; the 20:20 pass finds nothing. Idempotent.

create table if not exists public.arbox_daily_run_status (
  business_id bigint not null references public.businesses (id) on delete cascade,
  run_day date not null,
  slot text not null default 'morning',
  status text not null default 'ok',
  reason text null,
  attempts integer not null default 1,
  pass text not null default 'main',
  updated_at timestamptz not null default now(),
  primary key (business_id, run_day, slot)
);

create index if not exists idx_arbox_daily_run_status_day_slot
  on public.arbox_daily_run_status (run_day, slot, status);

create index if not exists idx_arbox_daily_run_status_incomplete_recent
  on public.arbox_daily_run_status (updated_at desc)
  where status = 'incomplete';

alter table public.arbox_daily_run_status enable row level security;
