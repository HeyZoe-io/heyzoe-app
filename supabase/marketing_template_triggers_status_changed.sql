-- טריגר «ליד עבר לסטטוס» בזואי אדמין.
-- הריצו ב-Supabase SQL Editor.
-- שולח טמפלייט רק ברגע שהסטטוס משתנה, לא למי שכבר בעמודה.
-- שליחה מיידית או מתוזמנת נשטפת ע"י הקרון הקיים:
--   GET /api/cron/scheduled-template-sends  (cron-job.org, לא Vercel)

alter table public.marketing_template_triggers
  drop constraint if exists marketing_template_triggers_trigger_type_check;

alter table public.marketing_template_triggers
  add constraint marketing_template_triggers_trigger_type_check
  check (trigger_type in ('node_answered', 'flow_completed', 'call_day', 'status_changed'));

alter table public.marketing_template_triggers
  add column if not exists target_status text null default null;

comment on column public.marketing_template_triggers.target_status is
  'For status_changed: admin column the lead just entered (setup_call, in_process, requires_call, followup, no_response, not_interested, registered, not_relevant).';
