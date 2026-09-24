-- סטטוס «שיחת הקמה» בזואי אדמין (מי שנקבעה מולו שיחת הקמה).
-- להריץ ב-Supabase SQL Editor אחרי marketing_admin_status_layers.sql.
-- אין cron חדש. שמירת הסטטוס נשארת בקריאה הקיימת (בלי סריקה).

alter table public.marketing_conversation_notes
  drop constraint if exists marketing_conversation_notes_status_check;

alter table public.marketing_conversation_notes
  add constraint marketing_conversation_notes_status_check
  check (status in (
    'in_process',
    'requires_call',
    'followup',
    'no_response',
    'not_interested',
    'setup_call',
    'registered',
    'not_relevant'
  ));

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
      'none',
      'in_process',
      'requires_call',
      'setup_call'
    )
  );
