-- Class-cancelled customer notify: snapshot of future Arbox registrations.
-- Scheduling: cron-job.org hourly → GET /api/cron/arbox-class-cancel-notify
--   Authorization: Bearer CRON_SECRET. Not a Vercel cron (Hobby).
-- Horizon in app code: CLASS_CANCEL_SNAPSHOT_HORIZON_DAYS = 7 (today..today+7).
-- Do not hard-delete a row because the person left bookingsReport.
-- Retention (in the cron): delete class_date < today-7.
-- template_triggers.trigger_type has no CHECK / enum in this project, so
-- class_cancelled_customer does not need a constraint change here.
--
-- RUN THIS IN THE SUPABASE SQL EDITOR before deploying the cron. Not applied by the app.

create table if not exists public.arbox_future_booking_snapshot (
  business_id bigint not null references public.businesses (id) on delete cascade,
  schedule_id text not null,
  user_id text not null,
  phone text null,
  first_name text null,
  class_name text not null,
  class_date date not null,
  class_time text not null,
  user_role text null,
  first_seen_at timestamptz not null default now(),
  disappeared_at timestamptz null,
  class_cancelled_at timestamptz null,
  notify_status text null,
  notified_at timestamptz null,
  attempts int not null default 0,
  primary key (business_id, schedule_id, user_id),
  constraint arbox_future_booking_snapshot_notify_status_check
    check (
      notify_status is null
      or notify_status in (
        'pending',
        'sent',
        'failed',
        'skipped_past',
        'skipped_no_phone',
        'skipped_opted_out',
        'skipped_gate'
      )
    ),
  constraint arbox_future_booking_snapshot_attempts_check
    check (attempts >= 0)
);

create index if not exists idx_arbox_future_booking_snapshot_schedule
  on public.arbox_future_booking_snapshot (business_id, schedule_id);

create index if not exists idx_arbox_future_booking_snapshot_pending
  on public.arbox_future_booking_snapshot (business_id)
  where notify_status = 'pending';

comment on table public.arbox_future_booking_snapshot is
  'Future Arbox class registrations, stamped with classesSummaryReport schedule_id, so a later cancellation can still reach who was booked. PK business_id+schedule_id+user_id. No hard delete on disappearance.';

comment on column public.arbox_future_booking_snapshot.class_cancelled_at is
  'cancelledSessionsReport.cancelled_time interpreted as Asia/Jerusalem wall time.';

comment on column public.arbox_future_booking_snapshot.notify_status is
  'null until the class is cancelled. pending retries; sent is terminal (one message per PK).';

comment on column public.arbox_future_booking_snapshot.attempts is
  'Meta send tries. Transient failures stay pending until 3, then failed. Skips do not increment.';

grant select, insert, update, delete
  on public.arbox_future_booking_snapshot
  to authenticated;

grant select, insert, update, delete
  on public.arbox_future_booking_snapshot
  to service_role;

alter table public.arbox_future_booking_snapshot
  enable row level security;

-- No authenticated policies: the hourly cron uses the service role, which bypasses RLS.
-- Client access stays blocked.
