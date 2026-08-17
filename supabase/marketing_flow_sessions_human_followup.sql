-- פולואפ אנושי לפייפליין לידים של זואי אדמין (/admin/leads)
-- Scheduling: לא cron חדש. פולואפים אוטומטיים מדלגים על לידים עם human_followup_at.
alter table public.marketing_flow_sessions
  add column if not exists human_followup_at timestamptz null;

alter table public.marketing_flow_sessions
  add column if not exists next_call_at date null;

comment on column public.marketing_flow_sessions.human_followup_at is
  'סימון ידני: הליד בפולואפ אנושי בפייפליין האדמין. NULL = לא בפולואפ אנושי.';

comment on column public.marketing_flow_sessions.next_call_at is
  'תאריך השיחה הבאה (YYYY-MM-DD) לליד בפולואפ אנושי. NULL מותר גם כשהליד מסומן.';

create index if not exists idx_mf_sessions_human_followup
  on public.marketing_flow_sessions (next_call_at)
  where human_followup_at is not null;
