-- זואי אדמין: סטטוס-על (רלוונטי / לא רלוונטי) בנפרד מהסטטוס המשני.
-- להריץ ב-Supabase SQL Editor.
-- אין cron חדש. הזרמה למטא נשארת בשמירת סטטוס (לא סריקה).

alter table public.marketing_conversation_notes
  add column if not exists relevance text not null default 'relevant';

alter table public.marketing_conversation_notes
  drop constraint if exists marketing_conversation_notes_relevance_check;

alter table public.marketing_conversation_notes
  add constraint marketing_conversation_notes_relevance_check
  check (relevance in ('relevant', 'not_relevant'));

update public.marketing_conversation_notes
set relevance = 'not_relevant'
where status = 'not_relevant'
  and relevance is distinct from 'not_relevant';

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
    'registered',
    'not_relevant'
  ));

comment on column public.marketing_conversation_notes.relevance is
  'סטטוס-על: relevant או not_relevant. לא תלוי בסטטוס המשני. מטא מסתנכרנת רק לפי השדה הזה.';

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
      'requires_call'
    )
  );
