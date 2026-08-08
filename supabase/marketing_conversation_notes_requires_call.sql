-- הוספת סטטוס «דורש שיחה» להערות שיחות שיווק
-- הרצה ב-Supabase SQL Editor.

alter table public.marketing_conversation_notes
  drop constraint if exists marketing_conversation_notes_status_check;

alter table public.marketing_conversation_notes
  add constraint marketing_conversation_notes_status_check
  check (status in (
    'in_process',
    'not_relevant',
    'registered',
    'no_response',
    'not_interested',
    'requires_call'
  ));
