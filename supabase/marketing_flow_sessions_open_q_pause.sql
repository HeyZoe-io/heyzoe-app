-- שאלה פתוחה באמצע פלואו שיווקי: await_resume | more_questions | none
alter table public.marketing_flow_sessions
  add column if not exists open_q_pause_state text not null default 'none';

alter table public.marketing_flow_sessions
  drop constraint if exists marketing_flow_sessions_open_q_pause_state_check;

alter table public.marketing_flow_sessions
  add constraint marketing_flow_sessions_open_q_pause_state_check
  check (open_q_pause_state in ('none', 'await_resume', 'more_questions'));

comment on column public.marketing_flow_sessions.open_q_pause_state is
  'none=רגיל; await_resume=אחרי שאלה פתוחה מחכים ל«בואו נמשיך»/«יש לי עוד שאלה»; more_questions=מחכים לשאלה נוספת';
