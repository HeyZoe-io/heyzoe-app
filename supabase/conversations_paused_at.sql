-- When the bot was paused — used for auto-unpause after 15 minutes (cron owner-notifications)
alter table public.conversations
  add column if not exists paused_at timestamptz null;

comment on column public.conversations.paused_at is
  'Set when bot_paused becomes true; cleared on unpause or auto-unpause after 15 minutes';
