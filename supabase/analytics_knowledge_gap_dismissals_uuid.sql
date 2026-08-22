-- שינוי טיפוס בלבד: assistant_message_id bigint → uuid (כמו messages.id).
-- אין DROP/TRUNCATE/DELETE. הטבלה ריקה — אין שורות לדחייה.
-- הרצה ב-Supabase SQL Editor.

alter table public.analytics_knowledge_gap_dismissals
  alter column assistant_message_id type uuid using null::uuid;
