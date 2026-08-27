-- שעת שיחה לפולואפ אנושי בפייפליין לידים (/admin/leads)
-- next_call_at נשאר date; השעה נשמרת בנפרד כדי לא לשבור שורות קיימות.
-- Scheduling: לא cron חדש.
alter table public.marketing_flow_sessions
  add column if not exists next_call_time time null;

comment on column public.marketing_flow_sessions.next_call_time is
  'שעת השיחה הבאה (HH:MM) לליד בפולואפ אנושי. NULL = רק תאריך / לא נקבעה שעה.';
