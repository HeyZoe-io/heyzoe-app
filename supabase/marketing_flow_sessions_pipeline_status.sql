-- סטטוס ידני בפייפליין לידים של זואי אדמין (/admin/leads)
-- גרירה בין עמודות מעדכנת את השדה בלי לשלוח הודעה לליד.
-- NULL = הסטטוס נגזר מפעילות / מהערות CRM (marketing_conversation_notes).
-- Scheduling: לא cron חדש (cron-job.org ל־marketing-followups הקיים).
alter table public.marketing_flow_sessions
  add column if not exists pipeline_status text null;

alter table public.marketing_flow_sessions
  drop constraint if exists marketing_flow_sessions_pipeline_status_check;

alter table public.marketing_flow_sessions
  add constraint marketing_flow_sessions_pipeline_status_check
  check (
    pipeline_status is null
    or pipeline_status in (
      'template',
      'active',
      'followup',
      'human_followup',
      'no_response',
      'human_requested',
      'registered_human_requested',
      'registered',
      'not_relevant',
      'opted_out',
      'none'
    )
  );

comment on column public.marketing_flow_sessions.pipeline_status is
  'סטטוס ידני בפייפליין אדמין. NULL = חישוב אוטומטי / הערות CRM.';
