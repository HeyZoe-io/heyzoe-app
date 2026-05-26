-- זואי אדמין: סימון שליחת התראת "ללא מענה" אחרי פולואפ שלישי
alter table public.marketing_flow_sessions
  add column if not exists no_response_notified_at timestamptz null;

create index if not exists idx_mfs_no_response_notify
  on public.marketing_flow_sessions (followup_3_sent_at)
  where followup_3_sent_at is not null and no_response_notified_at is null;
