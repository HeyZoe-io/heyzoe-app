-- Freeze cluster A8 / C14 / C15 (membersOnHoldReport).
-- Scheduling: cron-job.org → GET /api/cron/arbox-daily-triggers (not Vercel crons — Hobby).
-- A8 freeze_created: PK (business_id, membership_hold_id) — confirmation once per hold.
-- C14/C15 freeze_ending: PK (business_id, membership_hold_id, end_suspend_ymd) — one ending
--   message per hold end; variant booked|unbooked is a column, not part of PK.
-- Shared seed flag; soft-seed per table when empty after flag is true.
-- Retry: attempts + status (gated does not increment; only send_failed).
-- Filter: C14/C15 require end_suspend_ymd > today (report includes ended holds).
--
-- RUN THIS IN THE SUPABASE SQL EDITOR before deploying app code that uses these tables.

alter table public.businesses
  add column if not exists arbox_freeze_seeded boolean not null default false;

comment on column public.businesses.arbox_freeze_seeded is
  'True after the first freeze cluster (A8/C14/C15) pass seeded current holds without WhatsApp.';

create table if not exists public.arbox_freeze_created_sync_log (
  business_id bigint not null references public.businesses (id) on delete cascade,
  membership_hold_id bigint not null,
  user_id bigint null,
  contact_id uuid null references public.contacts (id) on delete set null,
  processed_at timestamptz not null default now(),
  attempts int not null default 0,
  status text not null default 'pending',
  primary key (business_id, membership_hold_id),
  constraint arbox_freeze_created_sync_log_status_check
    check (status in ('pending', 'seeded', 'sent', 'abandoned', 'no_phone'))
);

create index if not exists idx_arbox_freeze_created_sync_log_processed_at
  on public.arbox_freeze_created_sync_log (processed_at);

comment on table public.arbox_freeze_created_sync_log is
  'A8 freeze_created: one confirmation per membership_hold_id. Separate from ending reminders.';

create table if not exists public.arbox_freeze_ending_sync_log (
  business_id bigint not null references public.businesses (id) on delete cascade,
  membership_hold_id bigint not null,
  end_suspend_ymd date not null,
  variant text not null,
  user_id bigint null,
  contact_id uuid null references public.contacts (id) on delete set null,
  processed_at timestamptz not null default now(),
  attempts int not null default 0,
  status text not null default 'pending',
  primary key (business_id, membership_hold_id, end_suspend_ymd),
  constraint arbox_freeze_ending_sync_log_variant_check
    check (variant in ('booked', 'unbooked')),
  constraint arbox_freeze_ending_sync_log_status_check
    check (status in ('pending', 'seeded', 'sent', 'abandoned', 'no_phone'))
);

create index if not exists idx_arbox_freeze_ending_sync_log_processed_at
  on public.arbox_freeze_ending_sync_log (processed_at);

create index if not exists idx_arbox_freeze_ending_sync_log_biz_variant
  on public.arbox_freeze_ending_sync_log (business_id, variant);

comment on table public.arbox_freeze_ending_sync_log is
  'C14/C15 freeze ending: one message per hold+end date. variant records booked vs unbooked at send/seed time.';

comment on column public.arbox_freeze_ending_sync_log.variant is
  'booked = C15 (has future booking); unbooked = C14. Not in PK so booking flips cannot double-send.';

grant select, insert, update, delete
  on public.arbox_freeze_created_sync_log
  to service_role;

grant select, insert, update, delete
  on public.arbox_freeze_ending_sync_log
  to service_role;

alter table public.arbox_freeze_created_sync_log
  enable row level security;

alter table public.arbox_freeze_ending_sync_log
  enable row level security;
