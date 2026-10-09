-- Meta revoke.original_message_id for a deleted WhatsApp message.
-- The revoke event row keeps content '[revoke]'. This column points at the
-- wamid that was deleted. Null on every other row.
-- The app inserts without the column when it is not there yet.
-- RUN THIS IN THE SUPABASE SQL EDITOR.

alter table public.messages
  add column if not exists revoke_original_message_id text default null;

comment on column public.messages.revoke_original_message_id is
  'Meta revoke.original_message_id. Set only on a revoke event row, so the deleted message can be identified.';

create index if not exists idx_messages_revoke_original_message_id
  on public.messages (revoke_original_message_id)
  where revoke_original_message_id is not null;
