-- Membership-cancelled send retry cap (A9).
-- Run AFTER supabase/arbox_cancellation_sync_log.sql (in the Supabase SQL editor).
-- Adds attempts + status so gated/send_failed rows can be retried with a bound.
-- Existing rows (seed / success / no_phone from the pre-cap code) backfill to status='sent'.

alter table public.arbox_cancellation_sync_log
  add column if not exists attempts int not null default 0;

alter table public.arbox_cancellation_sync_log
  add column if not exists status text not null default 'pending';

comment on column public.arbox_cancellation_sync_log.attempts is
  'Count of real send_failed attempts. gated does not increment. Cap ARBOX_SYNC_SEND_ATTEMPT_CAP (3).';

comment on column public.arbox_cancellation_sync_log.status is
  'pending = retry; seeded/sent/abandoned/no_phone = terminal.';

do $$
begin
  alter table public.arbox_cancellation_sync_log
    add constraint arbox_cancellation_sync_log_status_check
    check (status in ('pending', 'seeded', 'sent', 'abandoned', 'no_phone'));
exception
  when duplicate_object then null;
end
$$;

update public.arbox_cancellation_sync_log
set status = 'sent'
where status = 'pending';
