-- נוד «יום ושעה» אחרי נוד מוצר. בטוח להרצה חוזרת.
-- הריצו ב-Supabase SQL Editor.

alter table public.business_conversation_nodes
  drop constraint if exists business_conversation_nodes_type_check;

alter table public.business_conversation_nodes
  add constraint business_conversation_nodes_type_check
  check (type in ('message', 'question', 'product', 'daytime', 'register'));
