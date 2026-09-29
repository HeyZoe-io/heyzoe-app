-- פולואפ כתיבה במסלול השיחה (פיפמן בלבד). לא נרשם ב-vercel.json.
-- השליחה רצה מתוך /api/cron/wa-followups שכבר מתוזמן ב-cron-job.org.
-- הריצו ב-Supabase SQL Editor.

alter table public.business_conversation_nodes
  drop constraint if exists business_conversation_nodes_type_check;

alter table public.business_conversation_nodes
  add constraint business_conversation_nodes_type_check
  check (type in ('message', 'question', 'product', 'daytime', 'register', 'followup'));

alter table public.business_conversation_sessions
  add column if not exists pending_followup_node_id uuid;

alter table public.business_conversation_sessions
  drop constraint if exists business_conversation_sessions_pending_followup_node_id_fkey;

alter table public.business_conversation_sessions
  add constraint business_conversation_sessions_pending_followup_node_id_fkey
  foreign key (pending_followup_node_id)
  references public.business_conversation_nodes(id)
  on delete set null;

alter table public.business_conversation_sessions
  add column if not exists followup_due_at timestamptz;

create index if not exists idx_bcs_followup_due
  on public.business_conversation_sessions (followup_due_at)
  where followup_due_at is not null and flow_completed = false;
