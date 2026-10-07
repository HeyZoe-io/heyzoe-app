-- Trainer phone for class_cancelled_customer.
-- classesSummaryReport.staff_member.phone is only present while the class is
-- still active. The hourly cron (cron-job.org → GET /api/cron/arbox-class-cancel-notify)
-- already fetches that report; this table stores the latest trainer per class
-- so a later cancellation can still reach them. No backfill: cancellations
-- that happened before the first successful capture are not notified.
--
-- RUN THIS IN THE SUPABASE SQL EDITOR. The app does not apply it.
-- Until it runs, the cron skips trainer capture and trainer sends and keeps
-- notifying registered customers.

create table if not exists public.arbox_class_trainer_snapshot (
  business_id bigint not null references public.businesses (id) on delete cascade,
  schedule_id text not null,
  slot text not null,
  staff_user_id text not null,
  phone text null,
  full_name text null,
  class_name text not null,
  class_date date not null,
  class_time text not null,
  seen_at timestamptz not null default now(),
  primary key (business_id, schedule_id, slot),
  constraint arbox_class_trainer_snapshot_slot_check
    check (slot in ('primary', 'second'))
);

create index if not exists idx_arbox_class_trainer_snapshot_date
  on public.arbox_class_trainer_snapshot (business_id, class_date);

comment on table public.arbox_class_trainer_snapshot is
  'Latest Arbox trainer for an active class occurrence, copied from classesSummaryReport while the class is still listed. PK business_id+schedule_id+slot (primary or second). Last sighting wins. Not deleted when the class drops off the summary, so class_cancelled_customer can still message the trainer.';

comment on column public.arbox_class_trainer_snapshot.phone is
  'normalizePhone of staff_member.phone. A later sighting of the same staff_user_id does not replace a known phone with null.';

comment on column public.arbox_class_trainer_snapshot.seen_at is
  'When this slot was last seen on an active classesSummaryReport row.';

grant select, insert, update, delete
  on public.arbox_class_trainer_snapshot
  to authenticated;

grant select, insert, update, delete
  on public.arbox_class_trainer_snapshot
  to service_role;

alter table public.arbox_class_trainer_snapshot
  enable row level security;

-- No authenticated policies: the hourly cron uses the service role, which bypasses RLS.
-- Client access stays blocked.
