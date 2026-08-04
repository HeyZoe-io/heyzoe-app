-- Sessions / punch-card expiring trigger (Arbox expiringSessionsReport).
-- Scheduling: cron-job.org → GET /api/cron/arbox-daily-triggers (4th step; not Vercel crons).
-- Live report has NO pass-instance id — dedup uses (user_id, start_date, end_date) as the pack identity.
-- Rows with null end_date are skipped in code (cannot compute due_at).
-- Server-side only (service_role); RLS enabled with no client policies (= deny-all).

create table if not exists public.arbox_sessions_expiring_sync_log (
  business_id bigint not null references public.businesses (id) on delete cascade,
  user_id bigint not null,
  start_date date not null,
  end_date date not null,
  contact_id uuid null references public.contacts (id) on delete set null,
  processed_at timestamptz not null default now(),
  primary key (business_id, user_id, start_date, end_date)
);

create index if not exists idx_arbox_sessions_expiring_sync_log_processed_at
  on public.arbox_sessions_expiring_sync_log (processed_at);

comment on table public.arbox_sessions_expiring_sync_log is
  'Arbox sessions_expiring triggers already processed (per punch-card pack identity + end_date).';

comment on column public.arbox_sessions_expiring_sync_log.user_id is
  'Arbox customer user_id from expiringSessionsReport (no membership_user_id in live API).';

comment on column public.arbox_sessions_expiring_sync_log.start_date is
  'Pack start_date — discriminates pass instances for the same customer.';

comment on column public.arbox_sessions_expiring_sync_log.end_date is
  'Pack end_date (expiry) from expiringSessionsReport; renewed later expiry is a new PK.';

grant select, insert, update, delete
  on public.arbox_sessions_expiring_sync_log
  to service_role;

alter table public.arbox_sessions_expiring_sync_log
  enable row level security;
