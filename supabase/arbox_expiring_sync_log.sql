-- Membership-expiring trigger detection (Arbox expiringMembershipsReport).
-- Scheduling: cron-job.org → GET /api/cron/arbox-daily-triggers (second step; not Vercel crons).
-- Dedup per membership INSTANCE (membership_user_id + end_date), not per customer.
-- No seed flag — report is forward-looking (end_date in fromDate..toDate; past-only ranges return empty).
-- Server-side only (service_role); RLS enabled with no client policies (= deny-all).

create table if not exists public.arbox_expiring_sync_log (
  business_id bigint not null references public.businesses (id) on delete cascade,
  membership_user_id bigint not null,
  end_date date not null,
  contact_id uuid null references public.contacts (id) on delete set null,
  processed_at timestamptz not null default now(),
  primary key (business_id, membership_user_id, end_date)
);

create index if not exists idx_arbox_expiring_sync_log_processed_at
  on public.arbox_expiring_sync_log (processed_at);

comment on table public.arbox_expiring_sync_log is
  'Arbox membership_expiring triggers already processed (per membership instance + end_date).';

comment on column public.arbox_expiring_sync_log.membership_user_id is
  'Arbox membership_user_id — specific membership instance, not the customer user_id.';

comment on column public.arbox_expiring_sync_log.end_date is
  'Membership end_date from expiringMembershipsReport; renewed later expiry is a new PK.';

grant select, insert, update, delete
  on public.arbox_expiring_sync_log
  to service_role;

alter table public.arbox_expiring_sync_log
  enable row level security;
