-- Manual: run in the Supabase SQL editor.
-- Lets a trigger claim status 'sending' before the WhatsApp call,
-- and store a Meta failure as 'failed' (retried). Until this runs, a claim
-- is 'sent' with reason 'sending', and a Meta failure stays 'pending'.
-- Until this runs, the app stores the same claim as status 'sent' with reason 'sending'.
-- Either form is not retried. The daily admin summary lists both as «נשאר באמצע שליחה».

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
