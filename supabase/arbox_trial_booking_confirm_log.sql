-- Tights: confirmation after a trial class is booked, even with no sale.
-- Scheduling: existing cron-job.org GET /api/cron/arbox-trial-sync (not Vercel crons).
-- First pass seeds current future trial bookings and does not send WhatsApp.
--
-- RUN THIS IN THE SUPABASE SQL EDITOR before the app code sends these confirms.

alter table public.businesses
  add column if not exists arbox_trial_booking_confirm_seeded boolean not null default false;

comment on column public.businesses.arbox_trial_booking_confirm_seeded is
  'True after the first trial-booking confirm pass marked current future bookings without sending.';

create table if not exists public.arbox_trial_booking_confirm_log (
  business_id bigint not null references public.businesses (id) on delete cascade,
  user_id bigint not null,
  class_date date not null,
  class_time text not null,
  class_name text not null,
  processed_at timestamptz not null default now(),
  attempts int not null default 0,
  status text not null default 'pending',
  primary key (business_id, user_id, class_date, class_time, class_name),
  constraint arbox_trial_booking_confirm_log_status_check
    check (status in ('pending', 'seeded', 'sent', 'skipped', 'abandoned', 'no_phone'))
);

comment on table public.arbox_trial_booking_confirm_log is
  'One registration confirmation per future trial booking (no sale required). PK business_id+user_id+class_date+class_time+class_name.';

grant select, insert, update, delete
  on public.arbox_trial_booking_confirm_log
  to authenticated;

grant select, insert, update, delete
  on public.arbox_trial_booking_confirm_log
  to service_role;

alter table public.arbox_trial_booking_confirm_log
  enable row level security;
