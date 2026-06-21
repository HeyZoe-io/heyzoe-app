-- Dedup עמיד לעיבוד כפול של webhook נכנס (Meta/Twilio retry על אותה הודעה).
-- הזיכרון בתהליך (processedMessageIds) לא נשמר בין אינסטנסים של Vercel ולכן retry
-- שמגיע לאינסטנס אחר עיבד את אותה הודעה פעמיים → שתי תשובות שונות מ-Claude.
-- כאן עושים INSERT אטומי לפי message_id (PK) לפני העיבוד; conflict = כפילות → דילוג.

create table if not exists public.wa_processed_messages (
  message_id   text primary key,
  processed_at timestamptz not null default now()
);

-- לניקוי תקופתי (best-effort) של רשומות ישנות
create index if not exists idx_wa_processed_messages_processed_at
  on public.wa_processed_messages (processed_at);

grant select, insert, update, delete
  on public.wa_processed_messages
  to authenticated;

grant select, insert, update, delete
  on public.wa_processed_messages
  to service_role;

alter table public.wa_processed_messages
  enable row level security;
