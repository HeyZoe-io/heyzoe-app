-- אינדקס חלקי ליומן זואי אדמין (שיחת הקמה / דורש שיחה).
-- הריצו ב-Supabase SQL Editor. אין cron חדש: Google Calendar מושך /api/calendar/zoe-admin.
create index if not exists idx_mf_sessions_calendar_call_status
  on public.marketing_flow_sessions (pipeline_status, next_call_at)
  where pipeline_status in ('setup_call', 'requires_call', 'human_followup')
    and next_call_at is not null;
