-- Manual: run in the Supabase SQL editor. Idempotent: safe to run again.
-- Lets a trigger claim status 'sending' before the WhatsApp call,
-- and store a Meta failure as 'failed' (retried up to the attempt cap).
-- Until this runs, a claim is 'sent' with reason 'sending', and a Meta failure stays 'pending'.
-- A table without a status column: the claim is the row itself (any row = handled).
-- Either form is not retried. The daily admin summary lists both as «נשאר באמצע שליחה».
--
-- Step 1 adds status / attempts / reason where a claiming table does not have them.
-- Existing rows default to 'sent' (already handled), so nothing is sent again.
-- Step 2 replaces only CHECK constraints on the status column itself
-- (confirm_status / template_status checks are left alone).

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'arbox_birthday_sync_log',
    'arbox_sessions_expiring_sync_log',
    'arbox_credit_refusal_sync_log',
    'arbox_expiring_sync_log',
    'arbox_trial_sync_log',
    'arbox_new_lead_sync_log',
    'arbox_first_paid_purchase_log',
    'arbox_class_cancelled_customer_notify_log'
  ]
  loop
    if to_regclass('public.' || tbl) is null then
      continue;
    end if;
    execute format(
      'alter table public.%I add column if not exists status text not null default %L',
      tbl,
      'sent'
    );
    execute format(
      'alter table public.%I add column if not exists attempts integer not null default 0',
      tbl
    );
    execute format('alter table public.%I add column if not exists reason text null', tbl);
  end loop;
end $$;

do $$
declare
  tbl text;
  r record;
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
    'arbox_trial_booking_confirm_log'
  ]
  loop
    if to_regclass('public.' || tbl) is null then
      continue;
    end if;
    begin
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
        execute format('alter table public.%I drop constraint %I', tbl, r.conname);
      end loop;
      execute format(
        'alter table public.%I add constraint %I check (status in (%L, %L, %L, %L, %L, %L, %L, %L))',
        tbl,
        tbl || '_status_check',
        'pending',
        'seeded',
        'sent',
        'abandoned',
        'no_phone',
        'skipped',
        'sending',
        'failed'
      );
    exception
      when others then
        raise notice 'skip %: %', tbl, sqlerrm;
    end;
  end loop;
end $$;

-- arbox_class_cancelled_customer_notify_log keeps no status check: it also stores
-- skipped_past / skipped_no_phone / skipped_opted_out / skipped_gate.
