-- Meta wamid on every outbound messages row (Zoe replies, templates, manual sends,
-- manual bulk, owner/admin alerts, WhatsApp Business app echoes).
-- Joins messages to wa_message_statuses for the delivery ticks in the conversations page.
-- Idempotent. RUN THIS IN THE SUPABASE SQL EDITOR.
-- The app works before this runs: the first insert that hits the missing column logs one
-- error and the next 10 minutes insert without wamid.

alter table public.messages
  add column if not exists wamid text default null;

comment on column public.messages.wamid is
  'Meta message id (wamid) returned by Graph /messages for this outbound row. Null for inbound, Twilio, and rows from before Oct 2026.';

-- Partial: inbound rows (null) are not indexed, so the index stays about half the table.
create index if not exists idx_messages_wamid
  on public.messages (wamid)
  where wamid is not null;

-- Verify
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages' and column_name = 'wamid'
  ) as wamid_column_ok,
  to_regclass('public.idx_messages_wamid') is not null as wamid_index_ok;
