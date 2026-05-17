-- מצב שיחה לליד (התראות לבעל העסק + מעקב pause/CTA)
-- הרץ לפני conversations_owner_notifications.sql (או במקומו — הקובץ הזה כולל הכל)

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  business_id bigint not null references public.businesses(id) on delete cascade,
  phone text not null,
  session_id text null,
  bot_paused boolean not null default false,
  paused_notification_sent boolean not null default false,
  cta_clicked_at timestamptz null,
  cta_notification_sent boolean not null default false,
  fallback boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, phone)
);

create index if not exists idx_conversations_business_phone
  on public.conversations (business_id, phone);

create index if not exists idx_conversations_bot_paused_notify
  on public.conversations (business_id, bot_paused, paused_notification_sent)
  where bot_paused = true and paused_notification_sent = false;

create index if not exists idx_conversations_cta_notify
  on public.conversations (business_id, cta_clicked_at, cta_notification_sent)
  where cta_clicked_at is not null and cta_notification_sent = false;
