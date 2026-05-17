-- Owner WhatsApp notification preferences (per business)
create table if not exists public.notification_settings (
  business_id bigint primary key references public.businesses(id) on delete cascade,
  new_lead boolean not null default true,
  human_requested boolean not null default true,
  bot_paused_waiting boolean not null default true,
  cta_no_signup boolean not null default true,
  lead_registered boolean not null default true,
  daily_summary boolean not null default true,
  last_daily_summary_at timestamptz null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_notification_settings_business on public.notification_settings (business_id);
