-- Manual: run in the Supabase SQL editor. Idempotent: safe to run again.
-- Separates a Meta error from an unknown send outcome.
--   failed  : Meta answered with an error. Retried up to the attempt cap (3).
--   unknown : network error / timeout / no Meta answer. Never retried automatically.
-- Until this runs, the code stores unknown as 'sending' + reason 'send_outcome_unknown'
-- on the sync logs, and as 'failed' + last_error 'send_outcome_unknown' on the queues.
-- Both forms are final. The daily admin summary lists them as «תוצאה לא ידועה».
--
-- Step 1: sync logs. Re-adds the status check with 'unknown', only where a
-- single-column status check already exists. A table whose rows do not fit is
-- left unchanged (the block rolls back) and reported with a notice.

do $$
declare
  tbl text;
  r record;
  had_check boolean;
begin
  foreach tbl in array array[
    'arbox_cancellation_sync_log',
    'arbox_attendance_gap_sync_log',
    'arbox_freeze_created_sync_log',
    'arbox_freeze_ending_sync_log',
    'arbox_nth_workout_sync_log',
    'arbox_lost_lead_sync_log',
    'arbox_trial_reminder_sync_log',
    'arbox_post_trial_followup_sync_log',
    'arbox_missed_class_sync_log',
    'arbox_days_in_club_sync_log',
    'arbox_lead_status_change_sync_log',
    'arbox_birthday_sync_log',
    'arbox_sessions_expiring_sync_log',
    'arbox_credit_refusal_sync_log',
    'arbox_expiring_sync_log',
    'arbox_trial_sync_log',
    'arbox_new_lead_sync_log',
    'arbox_first_paid_purchase_log',
    'arbox_trial_booking_confirm_log',
    'arbox_trial_attended_sync_log'
  ]
  loop
    if to_regclass('public.' || tbl) is null then
      continue;
    end if;
    begin
      had_check := false;
      for r in
        select c.conname
        from pg_constraint c
        join pg_attribute a
          on a.attrelid = c.conrelid
         and a.attnum = any (c.conkey)
        where c.conrelid = ('public.' || tbl)::regclass
          and c.contype = 'c'
          and a.attname = 'status'
          and array_length(c.conkey, 1) = 1
      loop
        had_check := true;
        execute format('alter table public.%I drop constraint %I', tbl, r.conname);
      end loop;
      if had_check then
        execute format(
          'alter table public.%I add constraint %I check (status in (%L, %L, %L, %L, %L, %L, %L, %L, %L))',
          tbl,
          tbl || '_status_check',
          'pending',
          'seeded',
          'sent',
          'abandoned',
          'no_phone',
          'skipped',
          'sending',
          'failed',
          'unknown'
        );
      end if;
    exception
      when others then
        raise notice 'skip %: %', tbl, sqlerrm;
    end;
  end loop;
end $$;

-- Step 2: the template queue. 'unknown' is final; attempts counts Meta errors (cap 3).
alter table public.scheduled_template_sends
  add column if not exists attempts integer not null default 0;

alter table public.scheduled_template_sends
  drop constraint if exists scheduled_template_sends_status_check;

alter table public.scheduled_template_sends
  add constraint scheduled_template_sends_status_check
  check (status in ('pending', 'sending', 'sent', 'canceled', 'failed', 'unknown'));

-- Step 3: HeyZoe marketing queue and manual bulk queue. Unknown stays 'failed' (final) there;
-- attempts lets a Meta error go back to pending until the cap.
do $$
begin
  if to_regclass('public.scheduled_marketing_template_sends') is not null then
    alter table public.scheduled_marketing_template_sends
      add column if not exists attempts integer not null default 0;
  end if;
  if to_regclass('public.manual_bulk_queued_sends') is not null then
    alter table public.manual_bulk_queued_sends
      add column if not exists attempts integer not null default 0;
  end if;
end $$;
