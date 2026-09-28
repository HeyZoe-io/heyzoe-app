-- טקסטי פולואפ וזמני שליחה של זואי אדמין (קו שיווק). הרצה חוזרת בטוחה.
-- ריק ({}) = ברירת המחדל מהאפליקציה: 10 דקות / שעתיים / 23 שעות.
alter table marketing_flow_settings
  add column if not exists marketing_followups jsonb not null default '{}'::jsonb;

comment on column marketing_flow_settings.marketing_followups is
  'שלושה פולואפים של זואי אדמין: delay_minutes, text, enabled. {} = ברירת מחדל מהאפליקציה. שליחה רק בחלון החוקי (lib/israel-time).';
