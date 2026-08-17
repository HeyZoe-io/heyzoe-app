-- Arbox-native new-lead detection (allLeadsReport).
-- Scheduling: same cron-job.org job as arbox-trial-sync (separate step in that route).
-- Run in Supabase SQL editor. Do not apply from the app.

alter table public.businesses
  add column if not exists arbox_leads_seeded boolean not null default false;

comment on column public.businesses.arbox_leads_seeded is
  'True after the first allLeadsReport pass seeded the seen log without sending WhatsApp.';

-- Per-lead "seen" for seed + one opening message ever.
-- lead_id = allLeadsReport.user_id (report has no separate lead_id field).
create table if not exists public.arbox_new_lead_sync_log (
  business_id bigint not null references public.businesses (id) on delete cascade,
  lead_id bigint not null,
  contact_id uuid null references public.contacts (id) on delete set null,
  processed_at timestamptz not null default now(),
  primary key (business_id, lead_id)
);

create index if not exists idx_arbox_new_lead_sync_log_processed_at
  on public.arbox_new_lead_sync_log (processed_at);

comment on table public.arbox_new_lead_sync_log is
  'Arbox allLeadsReport user_ids already seen/seeded (PK business_id+lead_id). One opening message per lead ever.';

comment on column public.arbox_new_lead_sync_log.lead_id is
  'Arbox allLeadsReport user_id (stable unique lead identity; the report has no lead_id column).';

grant select, insert, update, delete
  on public.arbox_new_lead_sync_log
  to authenticated;

grant select, insert, update, delete
  on public.arbox_new_lead_sync_log
  to service_role;

alter table public.arbox_new_lead_sync_log
  enable row level security;
