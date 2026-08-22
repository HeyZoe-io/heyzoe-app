-- messages.id בפרודקשן הוא uuid (gen_random_uuid), לא bigint.
-- העמודה הישנה מנעה הצגת «מידע ששווה להוסיף» כי Number(uuid) = NaN.
-- הטבלה ריקה (הפיצ׳ר לא הציג פערים) — drop/add בטוח.
-- הרצה ב-Supabase SQL Editor.

alter table public.analytics_knowledge_gap_dismissals
  drop column if exists assistant_message_id;

alter table public.analytics_knowledge_gap_dismissals
  add column assistant_message_id uuid not null;

alter table public.analytics_knowledge_gap_dismissals
  add constraint analytics_knowledge_gap_dismissals_slug_mid_key
  unique (business_slug, assistant_message_id);
