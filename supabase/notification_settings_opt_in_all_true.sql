-- Ensure opt-in defaults: all owner notification types enabled.
alter table public.notification_settings
  alter column new_lead set default true,
  alter column human_requested set default true,
  alter column bot_paused_waiting set default true,
  alter column cta_no_signup set default true,
  alter column lead_registered set default true,
  alter column daily_summary set default true;

update public.notification_settings
set
  new_lead = true,
  cta_no_signup = true,
  updated_at = now()
where new_lead = false or cta_no_signup = false;
