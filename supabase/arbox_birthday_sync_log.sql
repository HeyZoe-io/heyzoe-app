-- Birthday trigger detection (Arbox birthdayReport).
-- Scheduling: cron-job.org → GET /api/cron/arbox-daily-triggers (not Vercel crons).
-- Once-per-year dedup; no seed flag (fetch only covers the delay window / today).
-- Server-side only (service_role); RLS enabled with no client policies (= deny-all).

create table if not exists public.arbox_birthday_sync_log (
  business_id bigint not null references public.businesses (id) on delete cascade,
  user_id bigint not null,
  birthday_year int not null,
  contact_id uuid null references public.contacts (id) on delete set null,
  processed_at timestamptz not null default now(),
  primary key (business_id, user_id, birthday_year)
);

create index if not exists idx_arbox_birthday_sync_log_processed_at
  on public.arbox_birthday_sync_log (processed_at);

comment on table public.arbox_birthday_sync_log is
  'Arbox birthday triggers already processed (once per user per calendar year).';

comment on column public.arbox_birthday_sync_log.birthday_year is
  'Calendar year of the celebration (not the birth year).';

grant select, insert, update, delete
  on public.arbox_birthday_sync_log
  to service_role;

alter table public.arbox_birthday_sync_log
  enable row level security;
