-- attendance_gap (bookingsReport last check_in=Yes; no future-booking split).
-- Scheduling: cron-job.org → GET /api/cron/arbox-daily-triggers (not Vercel crons — Hobby).
-- Grain: (user_id, variant, gap_start_date=last Yes date, tier=delay_days).
-- variant is always 'unbooked' (column kept in PK; booked path removed — no migration).
-- First enable seeds current gap states without WhatsApp (arbox_attendance_gap_seeded).
-- Soft-seed: a newly added tier with zero sync_log rows is seeded without send.
-- Retry cap: attempts + status (gated does not increment; only send_failed).
-- Window: past ≤30d (Arbox span cap) — gaps older than ~30d are out of scope (lost/win-back).
--
-- RUN THIS IN THE SUPABASE SQL EDITOR before deploying app code that uses the table.

alter table public.businesses
  add column if not exists arbox_attendance_gap_seeded boolean not null default false;

comment on column public.businesses.arbox_attendance_gap_seeded is
  'True after the first attendance_gap bookingsReport pass seeded current gap states without sending WhatsApp.';

create table if not exists public.arbox_attendance_gap_sync_log (
  business_id bigint not null references public.businesses (id) on delete cascade,
  user_id bigint not null,
  variant text not null,
  gap_start_date date not null,
  tier int not null,
  contact_id uuid null references public.contacts (id) on delete set null,
  processed_at timestamptz not null default now(),
  attempts int not null default 0,
  status text not null default 'pending',
  primary key (business_id, user_id, variant, gap_start_date, tier),
  constraint arbox_attendance_gap_sync_log_variant_check
    check (variant in ('booked', 'unbooked')),
  constraint arbox_attendance_gap_sync_log_tier_check
    check (tier > 0),
  constraint arbox_attendance_gap_sync_log_status_check
    check (status in ('pending', 'seeded', 'sent', 'abandoned', 'no_phone'))
);

create index if not exists idx_arbox_attendance_gap_sync_log_processed_at
  on public.arbox_attendance_gap_sync_log (processed_at);

create index if not exists idx_arbox_attendance_gap_sync_log_biz_variant_tier
  on public.arbox_attendance_gap_sync_log (business_id, variant, tier);

comment on table public.arbox_attendance_gap_sync_log is
  'Attendance-gap tiers already processed/seeded. PK includes gap_start_date (last Yes) so a new episode after re-attendance can fire again.';

comment on column public.arbox_attendance_gap_sync_log.variant is
  'Always unbooked for attendance_gap (booked path removed). Kept in PK for compatibility.';

comment on column public.arbox_attendance_gap_sync_log.gap_start_date is
  'Date of last check_in=Yes that started this quiet episode (not registration/No).';

comment on column public.arbox_attendance_gap_sync_log.tier is
  'Gap threshold days from template_triggers.delay_days (typically 7/14/21).';

comment on column public.arbox_attendance_gap_sync_log.attempts is
  'Count of real send_failed attempts. gated does not increment. Cap ARBOX_SYNC_SEND_ATTEMPT_CAP (3).';

comment on column public.arbox_attendance_gap_sync_log.status is
  'pending = retry; seeded/sent/abandoned/no_phone = terminal.';

comment on column public.arbox_attendance_gap_sync_log.user_id is
  'Arbox user_id. Soft-seed may insert user_id=0 as a one-shot sentinel when the cohort is empty.';

grant select, insert, update, delete
  on public.arbox_attendance_gap_sync_log
  to service_role;

alter table public.arbox_attendance_gap_sync_log
  enable row level security;
