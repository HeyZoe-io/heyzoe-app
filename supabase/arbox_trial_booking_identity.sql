-- Trial booking identity, stamped the first time a booking is recognized as a trial.
-- Arbox can clear membership_type_name on bookingsReport after a later purchase
-- (TIGHTS trialClassTitle, Oct 2026). registered_after_trial re-reads that report,
-- so the trial evidence has to live here.
--
-- Scheduling stays on the existing cron-job.org workers (arbox-trial-sync and
-- arbox-daily-triggers). Not a Vercel cron.
-- This file does not send WhatsApp. The backfill only copies rows already in
-- arbox_trial_booking_confirm_log.
--
-- RUN THIS IN THE SUPABASE SQL EDITOR. The app is safe before it runs:
-- a missing table falls back to name-only trial matching.

create table if not exists public.arbox_trial_booking_identity (
  business_id bigint not null references public.businesses (id) on delete cascade,
  user_id bigint not null,
  class_date date not null,
  class_time text not null,
  class_name text not null default '',
  membership_type_name text null,
  first_seen_at timestamptz not null default now(),
  primary key (business_id, user_id, class_date, class_time)
);

create index if not exists idx_arbox_trial_booking_identity_user
  on public.arbox_trial_booking_identity (business_id, user_id);

comment on table public.arbox_trial_booking_identity is
  'A booking once recognized as a trial. PK business_id+user_id+class_date+class_time. Existence is the identity; membership_type_name is the label seen at first sighting and may be null on backfill.';

comment on column public.arbox_trial_booking_identity.membership_type_name is
  'Product label from the booking when it was first recognized (trialClassTitle or the intro product name). Null when backfilled from the confirm log, which did not store the label.';

-- One-time, idempotent. Does not send. Confirm-log rows are the first sighting.
insert into public.arbox_trial_booking_identity (
  business_id,
  user_id,
  class_date,
  class_time,
  class_name,
  membership_type_name
)
select distinct on (business_id, user_id, class_date, class_time)
  business_id,
  user_id,
  class_date,
  lpad(split_part(class_time, ':', 1), 2, '0') || ':' || split_part(class_time, ':', 2),
  coalesce(class_name, ''),
  null
from public.arbox_trial_booking_confirm_log
where class_time ~ '^\d{1,2}:\d{2}'
order by business_id, user_id, class_date, class_time, processed_at
on conflict (business_id, user_id, class_date, class_time) do nothing;

grant select, insert, update, delete
  on public.arbox_trial_booking_identity
  to authenticated;

grant select, insert, update, delete
  on public.arbox_trial_booking_identity
  to service_role;

alter table public.arbox_trial_booking_identity
  enable row level security;

-- No authenticated policies. The cron uses the service role, which bypasses RLS.
-- Client access stays blocked.
