-- When a business user opened the conversation of a failed delivery.
-- The owner dashboard's «failed messages» list shows only failed rows with seen_at null.
-- Set by POST /api/dashboard/conversation-failed-seen. Zoe admin opens do not set it.
-- Until this runs, the app keeps showing every failure (current behavior).
-- Idempotent. RUN THIS IN THE SUPABASE SQL EDITOR.

alter table public.wa_message_statuses
  add column if not exists seen_at timestamptz default null;

-- Verify
select count(*) filter (where seen_at is null) as unseen_rows
from public.wa_message_statuses
where status = 'failed';
