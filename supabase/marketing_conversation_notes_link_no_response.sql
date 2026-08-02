-- הרחבת הערות שיחות שיווק: שדה לינק + סטטוס «ללא מענה»
-- הרצה ב-Supabase SQL Editor אחרי marketing_conversation_notes.sql (אם כבר רצה).

alter table public.marketing_conversation_notes
  add column if not exists link text not null default '';

alter table public.marketing_conversation_notes
  drop constraint if exists marketing_conversation_notes_status_check;

alter table public.marketing_conversation_notes
  add constraint marketing_conversation_notes_status_check
  check (status in ('in_process', 'not_relevant', 'registered', 'no_response'));

comment on column public.marketing_conversation_notes.link is
  'לינק ידני לליד (אתר / דף נחיתה וכו׳)';
