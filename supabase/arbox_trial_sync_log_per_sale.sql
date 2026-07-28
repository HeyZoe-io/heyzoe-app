-- Per-sale "seen" log for Arbox salesReport trial sync (seed + already-processed).
-- Table empty in production — clean drop/recreate.

drop table if exists public.arbox_trial_sync_log;

create table public.arbox_trial_sync_log (
  business_id bigint not null references public.businesses (id) on delete cascade,
  sale_id bigint not null,
  contact_id uuid null references public.contacts (id) on delete set null,
  processed_at timestamptz not null default now(),
  primary key (business_id, sale_id)
);

create index if not exists idx_arbox_trial_sync_log_processed_at
  on public.arbox_trial_sync_log (processed_at);

comment on table public.arbox_trial_sync_log is
  'Arbox trial sales already seen/seeded (PK business_id+sale_id). Not the 2-day notify throttle.';

comment on column public.arbox_trial_sync_log.sale_id is
  'Arbox salesReport sale_id.';

comment on column public.arbox_trial_sync_log.contact_id is
  'Optional Zoe contact matched when the sale was processed/seeded (debug).';

comment on column public.arbox_trial_sync_log.processed_at is
  'When this sale_id was first recorded (seed or handler). Cleanup deletes by this column.';

grant select, insert, update, delete
  on public.arbox_trial_sync_log
  to authenticated;

grant select, insert, update, delete
  on public.arbox_trial_sync_log
  to service_role;

alter table public.arbox_trial_sync_log
  enable row level security;
