-- Align DB column defaults with opt-out-by-default notification policy.
-- Existing rows are unchanged; only new inserts use these defaults.
alter table public.notification_settings
  alter column human_requested set default false,
  alter column bot_paused_waiting set default false,
  alter column lead_registered set default false,
  alter column daily_summary set default false;
