-- Post-trial follow-up C5/C6 (registered vs not after trial attendance).
-- Scheduling: cron-job.org → GET /api/cron/arbox-daily-triggers (not Vercel crons — Hobby).
-- Replaces legacy trial_attended. Grain: one message per (user_id, class_date).
-- outcome: registered (C5) | not_registered (C6) from salesReport plan/session (not trial).
-- First enable seeds past decision-due attendances without WhatsApp.
-- Retry cap: attempts + status (gated does not increment; only send_failed).
--
-- RUN THIS IN THE SUPABASE SQL EDITOR before deploying app code that uses the table.

alter table public.businesses
  add column if not exists arbox_post_trial_followup_seeded boolean not null default false;

comment on column public.businesses.arbox_post_trial_followup_seeded is
  'True after the first post-trial C5/C6 pass seeded decision-due trial attendances without WhatsApp.';

create table if not exists public.arbox_post_trial_followup_sync_log (
  business_id bigint not null references public.businesses (id) on delete cascade,
  user_id bigint not null,
  class_date date not null,
  outcome text not null,
  contact_id uuid null references public.contacts (id) on delete set null,
  processed_at timestamptz not null default now(),
  attempts int not null default 0,
  status text not null default 'pending',
  primary key (business_id, user_id, class_date),
  constraint arbox_post_trial_followup_sync_log_outcome_check
    check (outcome in ('registered', 'not_registered')),
  constraint arbox_post_trial_followup_sync_log_status_check
    check (status in ('pending', 'seeded', 'sent', 'abandoned', 'no_phone'))
);

create index if not exists idx_arbox_post_trial_followup_sync_log_processed_at
  on public.arbox_post_trial_followup_sync_log (processed_at);

create index if not exists idx_arbox_post_trial_followup_sync_log_biz_outcome
  on public.arbox_post_trial_followup_sync_log (business_id, outcome);

comment on table public.arbox_post_trial_followup_sync_log is
  'C5/C6 post-trial follow-up. One row per trial attendance; outcome is registered vs not_registered.';

comment on column public.arbox_post_trial_followup_sync_log.outcome is
  'registered = plan/session purchase after trial (C5); not_registered = no such purchase (C6).';

comment on column public.arbox_post_trial_followup_sync_log.attempts is
  'Count of real send_failed attempts. gated does not increment. Cap ARBOX_SYNC_SEND_ATTEMPT_CAP (3).';

comment on column public.arbox_post_trial_followup_sync_log.status is
  'pending = retry; seeded/sent/abandoned/no_phone = terminal.';

grant select, insert, update, delete
  on public.arbox_post_trial_followup_sync_log
  to service_role;

alter table public.arbox_post_trial_followup_sync_log
  enable row level security;
