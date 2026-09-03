-- Membership-cancelled trigger (Arbox canceledMembershipsReport — American spelling, one L).
-- Scheduling: cron-job.org → GET /api/cron/arbox-daily-triggers (not Vercel crons — Hobby).
-- Grain: user_id + cancelled_time (report has no membership_user_id).
-- First enabled run seeds the 30-day window without sending WhatsApp.
-- Server-side only (service_role); RLS enabled with no client policies (= deny-all).
--
-- RUN THIS IN THE SUPABASE SQL EDITOR before the daily cron can pick up the trigger.
-- Then run supabase/arbox_cancellation_sync_log_attempts.sql (attempts + status retry cap).

alter table public.businesses
  add column if not exists arbox_cancellation_seeded boolean not null default false;

comment on column public.businesses.arbox_cancellation_seeded is
  'True after the first membership_cancelled canceledMembershipsReport pass seeded the seen log without sending WhatsApp.';

create table if not exists public.arbox_cancellation_sync_log (
  business_id bigint not null references public.businesses (id) on delete cascade,
  user_id bigint not null,
  cancelled_time text not null,
  contact_id uuid null references public.contacts (id) on delete set null,
  processed_at timestamptz not null default now(),
  primary key (business_id, user_id, cancelled_time)
);

create index if not exists idx_arbox_cancellation_sync_log_processed_at
  on public.arbox_cancellation_sync_log (processed_at);

comment on table public.arbox_cancellation_sync_log is
  'Arbox membership_cancelled events already processed/seeded (PK business_id+user_id+cancelled_time text).';

comment on column public.arbox_cancellation_sync_log.cancelled_time is
  'Trimmed raw canceledMembershipsReport.cancelled_time (text grain; not a timestamptz).';

comment on column public.arbox_cancellation_sync_log.user_id is
  'Arbox user_id from canceledMembershipsReport (no membership_user_id on this report).';

grant select, insert, update, delete
  on public.arbox_cancellation_sync_log
  to service_role;

alter table public.arbox_cancellation_sync_log
  enable row level security;
