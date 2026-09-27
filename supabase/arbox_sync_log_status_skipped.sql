-- Manual: run in the Supabase SQL editor before no_valid_name can be stored as terminal.
-- Adds status 'skipped' (reason no_valid_name) on Arbox sync logs that retry while status='pending'.
-- 'gated' (template not APPROVED) stays 'pending' and still retries.
-- Logs with no status column (birthday, trial_attended, credit_refusal, expiring,
-- sessions, first paid, new lead, trial sale) do not need this file.

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
    'arbox_days_in_club_sync_log'
  ]
  loop
    if to_regclass('public.' || tbl) is null then
      continue;
    end if;
    begin
      for r in
        select c.conname
        from pg_constraint c
        where c.conrelid = ('public.' || tbl)::regclass
          and c.contype = 'c'
          and pg_get_constraintdef(c.oid) ilike '%status%'
      loop
        execute format('alter table public.%I drop constraint %I', tbl, r.conname);
      end loop;
      execute format(
        'alter table public.%I add constraint %I check (status in (%L, %L, %L, %L, %L, %L))',
        tbl,
        tbl || '_status_check',
        'pending',
        'seeded',
        'sent',
        'abandoned',
        'no_phone',
        'skipped'
      );
    exception
      when others then
        raise notice 'arbox status skipped: % failed: %', tbl, sqlerrm;
    end;
  end loop;
end
$$;
