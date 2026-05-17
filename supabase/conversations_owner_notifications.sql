-- Per-lead conversation state for owner notifications
-- (assumes public.conversations exists with business_id)
alter table public.conversations
  add column if not exists phone text;

alter table public.conversations
  add column if not exists session_id text;

alter table public.conversations
  add column if not exists bot_paused boolean not null default false;

alter table public.conversations
  add column if not exists paused_notification_sent boolean not null default false;

alter table public.conversations
  add column if not exists cta_clicked_at timestamptz null;

alter table public.conversations
  add column if not exists cta_notification_sent boolean not null default false;

create index if not exists idx_conversations_bot_paused_notify
  on public.conversations (business_id, bot_paused, paused_notification_sent)
  where bot_paused = true and paused_notification_sent = false;

create index if not exists idx_conversations_cta_notify
  on public.conversations (business_id, cta_clicked_at, cta_notification_sent)
  where cta_clicked_at is not null and cta_notification_sent = false;
