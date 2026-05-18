-- Owner opt-in defaults: 4 on, 2 off (matches OWNER_OPT_IN_NOTIFICATION_SETTINGS in app).
alter table public.notification_settings
  alter column new_lead set default false,
  alter column human_requested set default true,
  alter column bot_paused_waiting set default true,
  alter column cta_no_signup set default false,
  alter column lead_registered set default true,
  alter column daily_summary set default true;
