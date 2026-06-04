-- Owner email notification preferences (per business)
alter table public.notification_settings
  add column if not exists lead_registered_email boolean not null default false,
  add column if not exists human_requested_email boolean not null default false,
  add column if not exists daily_summary_email boolean not null default false;
