-- A9 membership_cancelled: one sync_log grain per trigger rule so confirmation
-- + later win-back steps do not block each other. Backfill from template_triggers.
-- Scheduling: cron-job.org → /api/cron/arbox-daily-triggers.
--
-- RUN THIS IN THE SUPABASE SQL EDITOR before deploying app code that uses trigger_id.

alter table public.arbox_cancellation_sync_log
  add column if not exists trigger_id uuid not null
    default '00000000-0000-0000-0000-000000000000';

comment on column public.arbox_cancellation_sync_log.trigger_id is
  'template_triggers.id for this cancellation step. PK includes trigger_id so multiple delays can fire independently.';

update public.arbox_cancellation_sync_log as log
set trigger_id = t.id
from (
  select distinct on (business_id) business_id, id
  from public.template_triggers
  where trigger_type = 'membership_cancelled'
  order by business_id, created_at desc
) t
where t.business_id = log.business_id
  and log.trigger_id = '00000000-0000-0000-0000-000000000000';

alter table public.arbox_cancellation_sync_log
  drop constraint if exists arbox_cancellation_sync_log_pkey;

alter table public.arbox_cancellation_sync_log
  add primary key (business_id, trigger_id, user_id, cancelled_time);
