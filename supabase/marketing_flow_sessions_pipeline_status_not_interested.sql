-- עמודה «לא מעוניין» בפייפליין /admin/leads (נפרד מ«לא רלוונטי»).
-- להריץ ב-Supabase SQL Editor אחרי marketing_flow_sessions_pipeline_status.sql.
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
      'not_interested',
      'not_relevant',
      'opted_out',
      'none'
    )
  );
