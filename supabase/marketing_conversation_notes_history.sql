-- היסטוריית גרסאות להערות שיחות שיווק (שחזור אחרי דריסה בטעות)
-- הרצה ב-Supabase SQL Editor.

create table if not exists public.marketing_conversation_notes_history (
  id bigserial primary key,
  phone text not null,
  session_id text not null default '',
  business_name text not null default '',
  link text not null default '',
  notes text not null default '',
  status text not null default 'in_process',
  conversation_at date null,
  saved_at timestamptz not null default now()
);

create index if not exists idx_mcnh_phone_saved
  on public.marketing_conversation_notes_history (phone, saved_at desc);

comment on table public.marketing_conversation_notes_history is
  'גרסאות קודמות של marketing_conversation_notes לשחזור';

grant select, insert, update, delete
  on public.marketing_conversation_notes_history
  to authenticated;

grant select, insert, update, delete
  on public.marketing_conversation_notes_history
  to service_role;

grant usage, select
  on sequence public.marketing_conversation_notes_history_id_seq
  to authenticated;

grant usage, select
  on sequence public.marketing_conversation_notes_history_id_seq
  to service_role;

alter table public.marketing_conversation_notes_history
  enable row level security;
