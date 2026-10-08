-- Lead status changed (leadsInProcessReport snapshot diff).
-- Scheduling stays on the existing arbox-daily-triggers cron (09:00 and 20:00, lib/daily-run-slots.ts),
-- cron-job.org, not Vercel. No new cron URL.
-- Run this in the Supabase SQL editor before the dashboard can store a target status.
-- The app skips the step and sends nothing until these objects exist.

alter table public.businesses
  add column if not exists arbox_lead_status_last_scanned_at timestamptz null;

comment on column public.businesses.arbox_lead_status_last_scanned_at is
  'Last successful leadsInProcessReport snapshot for lead_status_changed. Null or older than 36h reseeds with no sends.';

alter table public.template_triggers
  add column if not exists target_status text null;

comment on column public.template_triggers.target_status is
  'lead_status_changed: the Arbox lead_status string this rule sends on entry. One status per rule.';

alter table public.arbox_lost_lead_sync_log
  add column if not exists reason text null;

comment on column public.arbox_lost_lead_sync_log.reason is
  'Optional skip reason. before_activation is expected and is omitted from the daily unsent summary.';

create table if not exists public.arbox_lead_status_snapshot (
  business_id bigint not null references public.businesses (id) on delete cascade,
  lead_id text not null,
  status text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (business_id, lead_id)
);

comment on table public.arbox_lead_status_snapshot is
  'Last seen Arbox lead_status per open lead. A missing row after a scan means the lead left the report, which is not a send.';

create table if not exists public.arbox_lead_known_statuses (
  business_id bigint not null references public.businesses (id) on delete cascade,
  status text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (business_id, status)
);

comment on table public.arbox_lead_known_statuses is
  'Status strings already observed for this business. A string seen for the first time is recorded and does not send.';

create table if not exists public.arbox_lead_status_change_sync_log (
  business_id bigint not null references public.businesses (id) on delete cascade,
  trigger_id uuid not null references public.template_triggers (id) on delete cascade,
  lead_id text not null,
  lead_status text not null,
  entered_at timestamptz not null,
  contact_id uuid null references public.contacts (id) on delete set null,
  processed_at timestamptz not null default now(),
  attempts int not null default 0,
  status text not null default 'pending',
  reason text null,
  created_at timestamptz not null default now(),
  primary key (business_id, trigger_id, lead_id, lead_status, entered_at),
  constraint arbox_lead_status_change_sync_log_status_check
    check (status in ('pending', 'seeded', 'sent', 'abandoned', 'no_phone', 'skipped'))
);

comment on table public.arbox_lead_status_change_sync_log is
  'One episode per entry into lead_status. entered_at is the previous scan time so a re-entry is a new row and an overlapping run loses the claim.';

comment on column public.arbox_lead_status_change_sync_log.lead_status is
  'Arbox lead_status string the lead entered. Not the sync status.';

comment on column public.arbox_lead_status_change_sync_log.status is
  'pending = retry; sent/skipped/seeded/abandoned/no_phone = terminal. reason mass_change or before_activation explains a skip.';

create index if not exists idx_arbox_lead_status_snapshot_business
  on public.arbox_lead_status_snapshot (business_id);

create index if not exists idx_arbox_lead_known_statuses_business
  on public.arbox_lead_known_statuses (business_id);

create index if not exists idx_arbox_lead_status_change_sync_log_processed
  on public.arbox_lead_status_change_sync_log (processed_at);

create index if not exists idx_arbox_lead_status_change_sync_log_biz_status_processed
  on public.arbox_lead_status_change_sync_log (business_id, status, processed_at);

grant select, insert, update, delete on public.arbox_lead_status_snapshot to authenticated, service_role;
grant select, insert, update, delete on public.arbox_lead_known_statuses to authenticated, service_role;
grant select, insert, update, delete on public.arbox_lead_status_change_sync_log to authenticated, service_role;

alter table public.arbox_lead_status_snapshot enable row level security;
alter table public.arbox_lead_known_statuses enable row level security;
alter table public.arbox_lead_status_change_sync_log enable row level security;
