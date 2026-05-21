-- פולואפים אוטומטיים לקו שיווקי (זואי אדמין) — cron /api/cron/marketing-followups
alter table public.marketing_flow_sessions
  add column if not exists last_user_message_at timestamptz null;

alter table public.marketing_flow_sessions
  add column if not exists followup_1_sent_at timestamptz null;

alter table public.marketing_flow_sessions
  add column if not exists followup_2_sent_at timestamptz null;

alter table public.marketing_flow_sessions
  add column if not exists followup_3_sent_at timestamptz null;

alter table public.marketing_flow_sessions
  add column if not exists followup_opted_out boolean not null default false;

create index if not exists idx_mf_sessions_followup_due
  on public.marketing_flow_sessions (flow_completed, followup_opted_out, last_user_message_at)
  where flow_completed = false and followup_opted_out = false and last_user_message_at is not null;

comment on column public.marketing_flow_sessions.last_user_message_at is
  'זמן הודעת משתמש אחרונה — לתזמון פולואפים (דגלי sent_at לא מתאפסים)';
